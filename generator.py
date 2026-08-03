"""Core video logic: probing, trim/normalize, and permutation concat.

Strategy: each source clip is trimmed and re-encoded ONCE into a uniform
intermediate format (same codec, resolution, fps, audio). Every permutation
is then a cheap stream-copy concat of those intermediates, so total encode
cost is O(n) rather than O(P(n,k) * k).
"""

import itertools
import json
import re
import subprocess
from pathlib import Path

TARGET_FPS = 30
DEFAULT_RES = (1280, 720)


class GenerationError(Exception):
    pass


def _run(cmd, timeout=600):
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if result.returncode != 0:
        raise GenerationError(
            f"{cmd[0]} failed ({' '.join(cmd[:6])}...):\n{result.stderr[-2000:]}"
        )
    return result.stdout


def check_ffmpeg():
    for tool in ("ffmpeg", "ffprobe"):
        try:
            subprocess.run([tool, "-version"], capture_output=True, check=True)
        except (OSError, subprocess.CalledProcessError):
            raise GenerationError(f"{tool} not found on PATH — install FFmpeg first")


def probe(path):
    """Return {duration, width, height, has_audio} for a video file."""
    out = _run([
        "ffprobe", "-v", "error", "-print_format", "json",
        "-show_format", "-show_streams", str(path),
    ])
    info = json.loads(out)
    video = next((s for s in info["streams"] if s["codec_type"] == "video"), None)
    if video is None:
        raise GenerationError(f"{Path(path).name}: no video stream")
    return {
        "duration": float(info["format"]["duration"]),
        "width": int(video["width"]),
        "height": int(video["height"]),
        "has_audio": any(s["codec_type"] == "audio" for s in info["streams"]),
    }


def probe_audio(path):
    """Return {duration} for an audio file (no video stream required)."""
    out = _run([
        "ffprobe", "-v", "error", "-print_format", "json",
        "-show_format", "-show_streams", str(path),
    ])
    info = json.loads(out)
    if not any(s["codec_type"] == "audio" for s in info["streams"]):
        raise GenerationError(f"{Path(path).name}: no audio stream")
    return {"duration": float(info["format"]["duration"])}


def trim_normalize(src, dst, offset, duration, use_audio, target_res=DEFAULT_RES):
    """Trim src at offset for duration and re-encode to the uniform format.

    use_audio=False (or a source with no audio stream) gets a silent track so
    every intermediate has identical streams for stream-copy concat.
    """
    w, h = target_res
    vf = (
        f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
        f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={TARGET_FPS}"
    )
    cmd = ["ffmpeg", "-y", "-ss", f"{offset:.3f}", "-t", f"{duration:.3f}", "-i", str(src)]
    if not use_audio:
        cmd += ["-f", "lavfi", "-t", f"{duration:.3f}",
                "-i", "anullsrc=channel_layout=stereo:sample_rate=44100"]
    cmd += [
        "-vf", vf,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-ar", "44100", "-ac", "2",
        "-map", "0:v:0", "-map", "0:a:0" if use_audio else "1:a:0",
        "-video_track_timescale", "90000",
        "-shortest", str(dst),
    ]
    _run(cmd)


def overlay_music(video, music, dst):
    """Mix the music file over the video's audio; video stream is copied.

    The music is looped if shorter than the video and cut at the video's end.
    """
    _run([
        "ffmpeg", "-y", "-i", str(video), "-stream_loop", "-1", "-i", str(music),
        "-filter_complex",
        "[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]",
        "-map", "0:v", "-map", "[a]",
        "-c:v", "copy", "-c:a", "aac", "-ar", "44100", "-ac", "2",
        "-shortest", str(dst),
    ])


def concat(trimmed_paths, dst, list_path):
    lines = "".join(f"file '{p}'\n" for p in trimmed_paths)
    Path(list_path).write_text(lines)
    _run([
        "ffmpeg", "-y", "-f", "concat", "-safe", "0",
        "-i", str(list_path), "-c", "copy", str(dst),
    ])


def _stem(name):
    s = re.sub(r"[^A-Za-z0-9_-]+", "", Path(name).stem)
    return s[:20] or "clip"


def count_permutations(n, k):
    count = 1
    for i in range(k):
        count *= n - i
    return count


def generate(run_dir, clips, k, duration, progress_cb=None, music_path=None):
    """Produce every ordered permutation of k clips as concatenated videos.

    clips: list of {"path": ..., "offset": seconds, "audio": bool} — offset is
    where the trimmed window starts in the source; audio=False silences that
    clip's own sound. music_path, if given, is mixed over every output
    (looped to fit).
    progress_cb(phase, done, total): optional progress reporting hook.
    Returns list of output file names.
    """
    run_dir = Path(run_dir)
    trimmed_dir = run_dir / "trimmed"
    output_dir = run_dir / "output"
    trimmed_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    paths = [c["path"] for c in clips]
    infos = [probe(p) for p in paths]
    target_res = (
        max((i["width"] for i in infos), default=DEFAULT_RES[0]),
        max((i["height"] for i in infos), default=DEFAULT_RES[1]),
    )
    # libx264 requires even dimensions
    target_res = (target_res[0] + target_res[0] % 2, target_res[1] + target_res[1] % 2)

    trimmed = []
    for idx, (clip, info) in enumerate(zip(clips, infos)):
        if progress_cb:
            progress_cb("normalizing clips", idx, len(clips))
        clip_len = info["duration"]
        # clamp the window inside the clip; short clips are used in full
        offset = min(max(float(clip.get("offset", 0)), 0), max(clip_len - duration, 0))
        use_audio = info["has_audio"] and clip.get("audio", True)
        dst = trimmed_dir / f"{idx:02d}_{_stem(clip['path'])}.mp4"
        trim_normalize(clip["path"], dst, offset, min(duration, clip_len),
                       use_audio, target_res)
        trimmed.append(dst)
    if progress_cb:
        progress_cb("normalizing clips", len(clips), len(clips))

    total = count_permutations(len(clips), k)
    outputs = []
    list_path = run_dir / "concat_list.txt"
    tmp_concat = run_dir / "concat_tmp.mp4"
    for num, perm in enumerate(itertools.permutations(range(len(clips)), k), 1):
        if progress_cb:
            progress_cb("concatenating permutations", num - 1, total)
        name = f"{num:0{len(str(total))}d}_" + "-".join(
            _stem(paths[i]) for i in perm) + ".mp4"
        parts = [trimmed[i].resolve() for i in perm]
        if music_path:
            concat(parts, tmp_concat, list_path)
            overlay_music(tmp_concat, music_path, output_dir / name)
        else:
            concat(parts, output_dir / name, list_path)
        outputs.append(name)
    tmp_concat.unlink(missing_ok=True)
    if progress_cb:
        progress_cb("done", total, total)
    return outputs
