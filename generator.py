"""Core video logic: probing, trim/normalize, and permutation concat.

Strategy: each source clip is trimmed and re-encoded ONCE into a uniform
intermediate format (same codec, resolution, fps, audio). Every permutation
is then a cheap stream-copy concat of those intermediates, so total encode
cost is O(n) rather than O(P(n,k) * k).
"""

import itertools
import json
import random
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


def _trim_offset(clip_len, duration, style, rng):
    if clip_len <= duration:
        return 0.0
    if style == "center":
        return (clip_len - duration) / 2
    if style == "random":
        return rng.uniform(0, clip_len - duration)
    return 0.0  # "start"


def trim_normalize(src, dst, offset, duration, has_audio, target_res=DEFAULT_RES):
    """Trim src at offset for duration and re-encode to the uniform format."""
    w, h = target_res
    vf = (
        f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
        f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={TARGET_FPS}"
    )
    cmd = ["ffmpeg", "-y", "-ss", f"{offset:.3f}", "-t", f"{duration:.3f}", "-i", str(src)]
    if not has_audio:
        cmd += ["-f", "lavfi", "-t", f"{duration:.3f}",
                "-i", "anullsrc=channel_layout=stereo:sample_rate=44100"]
    cmd += [
        "-vf", vf,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-ar", "44100", "-ac", "2",
        "-map", "0:v:0", "-map", "0:a:0" if has_audio else "1:a:0",
        "-video_track_timescale", "90000",
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


def generate(run_dir, clip_paths, k, duration, style, progress_cb=None, seed=None):
    """Produce every ordered permutation of k clips as concatenated videos.

    clip_paths: list of source video file paths.
    progress_cb(phase, done, total): optional progress reporting hook.
    Returns list of output file names.
    """
    run_dir = Path(run_dir)
    trimmed_dir = run_dir / "trimmed"
    output_dir = run_dir / "output"
    trimmed_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)
    rng = random.Random(seed)

    infos = [probe(p) for p in clip_paths]
    target_res = (
        max((i["width"] for i in infos), default=DEFAULT_RES[0]),
        max((i["height"] for i in infos), default=DEFAULT_RES[1]),
    )
    # libx264 requires even dimensions
    target_res = (target_res[0] + target_res[0] % 2, target_res[1] + target_res[1] % 2)

    trimmed = []
    for idx, (src, info) in enumerate(zip(clip_paths, infos)):
        if progress_cb:
            progress_cb("normalizing clips", idx, len(clip_paths))
        offset = _trim_offset(info["duration"], duration, style, rng)
        dst = trimmed_dir / f"{idx:02d}_{_stem(src)}.mp4"
        trim_normalize(src, dst, offset, min(duration, info["duration"]),
                       info["has_audio"], target_res)
        trimmed.append(dst)
    if progress_cb:
        progress_cb("normalizing clips", len(clip_paths), len(clip_paths))

    total = count_permutations(len(clip_paths), k)
    outputs = []
    list_path = run_dir / "concat_list.txt"
    for num, perm in enumerate(itertools.permutations(range(len(clip_paths)), k), 1):
        if progress_cb:
            progress_cb("concatenating permutations", num - 1, total)
        name = f"{num:0{len(str(total))}d}_" + "-".join(
            _stem(clip_paths[i]) for i in perm) + ".mp4"
        concat([trimmed[i].resolve() for i in perm], output_dir / name, list_path)
        outputs.append(name)
    if progress_cb:
        progress_cb("done", total, total)
    return outputs
