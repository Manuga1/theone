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


def trim_audio(src, dst, start, duration, volume=1.0):
    """Cut a segment out of an audio file at the given gain, re-encoded to AAC."""
    _run([
        "ffmpeg", "-y", "-ss", f"{start:.3f}", "-t", f"{duration:.3f}",
        "-i", str(src), "-vn", "-af", f"volume={volume:.3f}",
        "-c:a", "aac", "-ar", "44100", "-ac", "2",
        str(dst),
    ])


def overlay_music(video, music_paths, dst):
    """Mix one or more music files over the video's audio; video is copied.

    Each track plays once from the start of the video — no looping — and is
    cut at the video's end if longer.
    """
    cmd = ["ffmpeg", "-y", "-i", str(video)]
    for m in music_paths:
        cmd += ["-i", str(m)]
    inputs = "".join(f"[{i}:a]" for i in range(len(music_paths) + 1))
    cmd += [
        "-filter_complex",
        f"{inputs}amix=inputs={len(music_paths) + 1}:"
        "duration=first:dropout_transition=0:normalize=0[a]",
        "-map", "0:v", "-map", "[a]",
        "-c:v", "copy", "-c:a", "aac", "-ar", "44100", "-ac", "2",
        "-shortest", str(dst),
    ]
    _run(cmd)


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


def generate(run_dir, clips, k, duration, progress_cb=None, music_paths=None):
    """Produce every ordered permutation of k clips as concatenated videos.

    clips: list of {"path": ..., "offset": seconds, "audio": bool} — offset is
    where the trimmed window starts in the source; audio=False silences that
    clip's own sound. music_paths entries are {"path": ..., "start": s,
    "end": s|None} — each track is cut to its selection, then all are
    layered over every output, playing once (no looping).
    progress_cb(phase, done, total): optional progress reporting hook.
    Returns list of output file names.
    """
    run_dir = Path(run_dir)
    trimmed_dir = run_dir / "trimmed"
    output_dir = run_dir / "output"
    trimmed_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    music_files = []
    for i, m in enumerate(music_paths or []):
        info = probe_audio(m["path"])
        start = min(max(float(m.get("start", 0)), 0), info["duration"])
        end = m.get("end")
        end = info["duration"] if end is None else min(float(end), info["duration"])
        seg = max(end - start, 0.1)
        dst = run_dir / f"music_{i:02d}.m4a"
        trim_audio(m["path"], dst, start, seg, m.get("volume", 1.0))
        music_files.append(dst)

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
        if music_files:
            concat(parts, tmp_concat, list_path)
            overlay_music(tmp_concat, music_files, output_dir / name)
        else:
            concat(parts, output_dir / name, list_path)
        outputs.append(name)
    tmp_concat.unlink(missing_ok=True)
    if progress_cb:
        progress_cb("done", total, total)
    return outputs
