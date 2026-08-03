"""Minimal local web app for generating clip permutations. Personal use only.

Run: python app.py  ->  http://localhost:5000
"""

import threading
import time
import uuid
import zipfile
from pathlib import Path

from flask import (Flask, abort, jsonify, render_template, request, send_file,
                   send_from_directory)
from werkzeug.utils import secure_filename

import captions
import generator

BASE_DIR = Path(__file__).resolve().parent
WORKSPACE = BASE_DIR / "workspace"
UPLOADS = WORKSPACE / "uploads"
MUSIC_DIR = WORKSPACE / "music"
UPLOADS.mkdir(parents=True, exist_ok=True)
MUSIC_DIR.mkdir(parents=True, exist_ok=True)

WARN_THRESHOLD = 500   # above this, the client must send confirm=true
HARD_CAP = 5000        # above this, refuse outright

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 4 * 1024 * 1024 * 1024  # 4 GB per upload batch

jobs = {}          # run_id -> {phase, done, total, finished, error, outputs}
jobs_lock = threading.Lock()
current_job = {"run_id": None}


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/clips")
def clips():
    result = []
    for f in sorted(UPLOADS.iterdir()):
        if not f.is_file():
            continue
        try:
            info = generator.probe(f)
        except generator.GenerationError:
            continue
        result.append({"name": f.name, "duration": round(info["duration"], 2),
                       "resolution": f"{info['width']}x{info['height']}"})
    return jsonify(result)


@app.route("/upload", methods=["POST"])
def upload():
    saved = []
    for f in request.files.getlist("videos"):
        name = secure_filename(f.filename)
        if not name:
            continue
        f.save(UPLOADS / name)
        saved.append(name)
    return jsonify({"saved": saved})


@app.route("/delete", methods=["POST"])
def delete():
    name = secure_filename(request.json.get("name", ""))
    target = UPLOADS / name
    if name and target.is_file():
        target.unlink()
    return jsonify({"ok": True})


@app.route("/uploads/<path:filename>")
def uploaded_clip(filename):
    return send_from_directory(UPLOADS, filename)


@app.route("/caption_preview", methods=["POST"])
def caption_preview():
    """Render one real frame with the caption burned in, at the exact size
    and output resolution a generate run would use."""
    data = request.json
    style = data.get("style")
    if style not in ("classic", "highlight", "boxed", "neon"):
        return jsonify({"error": "pick a caption style first"}), 400
    if not generator.has_filter("ass"):
        return jsonify({"error": "your ffmpeg build has no subtitle (libass) "
                                 "support"}), 400
    names = [secure_filename(n) for n in data.get("clips", [])]
    paths = [UPLOADS / n for n in names if (UPLOADS / n).is_file()]
    if not paths:
        return jsonify({"error": "select at least one clip"}), 400
    canvas = data.get("canvas") or "auto"
    scale = min(max(float(data.get("scale", 1)), 0.3), 3.0)
    offset = max(float(data.get("offset", 0)), 0)
    text = (data.get("text") or "").strip() or "your captions look like this"

    if canvas in ("vertical", "vertical_pad"):
        target_res = (1080, 1920)
    else:
        infos = [generator.probe(p) for p in paths]
        target_res = (max(i["width"] for i in infos),
                      max(i["height"] for i in infos))
        target_res = (target_res[0] + target_res[0] % 2,
                      target_res[1] + target_res[1] % 2)

    preview_dir = WORKSPACE / "preview"
    preview_dir.mkdir(exist_ok=True)
    words = captions.words_from_text(" ".join(text.split()[:5]), 2.0)
    ass_path = captions.build_ass(words, style, target_res,
                                  preview_dir / "preview.ass", scale=scale)
    w, h = target_res
    if canvas == "vertical":
        vf = (f"scale={w}:{h}:force_original_aspect_ratio=increase,"
              f"crop={w}:{h},setsar=1")
    else:
        vf = (f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
              f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1")
    vf += (f",ass=filename={generator._quote_filter_path(ass_path)}"
           f":fontsdir={generator._quote_filter_path(captions.FONTS_DIR)}"
           f",scale=540:-2")
    png = preview_dir / "preview.png"
    try:
        generator._run(["ffmpeg", "-y", "-ss", f"{offset:.3f}",
                        "-i", str(paths[0]), "-frames:v", "1",
                        "-vf", vf, str(png)])
    except generator.GenerationError as e:
        return jsonify({"error": str(e)}), 500
    return send_file(png, mimetype="image/png", max_age=0)


@app.route("/transcribe", methods=["POST"])
def transcribe():
    # transcription only ever runs on uploaded audio tracks, never clip audio
    name = secure_filename(request.json.get("name", ""))
    target = MUSIC_DIR / name
    if not target.is_file():
        return jsonify({"error": f"{name} not found"}), 404
    try:
        result = captions.transcribe(target)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify(result)


@app.route("/music/<path:filename>")
def music_file(filename):
    return send_from_directory(MUSIC_DIR, filename)


@app.route("/music", methods=["GET", "POST", "DELETE"])
def music():
    if request.method == "POST":
        saved, errors = [], []
        for f in request.files.getlist("audio"):
            name = secure_filename(f.filename)
            if not name:
                continue
            target = MUSIC_DIR / name
            f.save(target)
            try:
                generator.probe_audio(target)
                saved.append(name)
            except generator.GenerationError as e:
                target.unlink()
                errors.append(str(e))
        if not saved and errors:
            return jsonify({"error": "; ".join(errors)}), 400
        return jsonify({"saved": saved, "errors": errors})
    if request.method == "DELETE":
        name = secure_filename((request.json or {}).get("name", ""))
        targets = [MUSIC_DIR / name] if name else list(MUSIC_DIR.iterdir())
        for t in targets:
            if t.is_file():
                t.unlink()
        return jsonify({"ok": True})
    tracks = []
    for f in sorted(MUSIC_DIR.iterdir()):
        if not f.is_file():
            continue
        try:
            info = generator.probe_audio(f)
        except generator.GenerationError:
            continue
        tracks.append({"name": f.name, "duration": round(info["duration"], 2)})
    return jsonify({"tracks": tracks})


@app.route("/generate", methods=["POST"])
def generate():
    data = request.json
    clips = []
    for c in data.get("clips", []):
        name = secure_filename(c.get("name", ""))
        cap = c.get("caption") or {}
        clips.append({
            "path": UPLOADS / name,
            "offset": max(float(c.get("offset", 0)), 0),
            "audio": bool(c.get("audio", True)) and not data.get("mute_all"),
            "caption": {"text": str(cap.get("text", "")),
                        "words": cap.get("words")},
        })
    k = int(data.get("k", 0))
    duration = float(data.get("duration", 0))
    canvas = data.get("canvas") or "auto"
    if canvas not in ("auto", "vertical", "vertical_pad"):
        return jsonify({"error": "unknown canvas mode"}), 400
    caption_style = data.get("caption_style") or None
    if caption_style not in (None, "classic", "highlight", "boxed", "neon"):
        return jsonify({"error": "unknown caption style"}), 400
    caption_scale = min(max(float(data.get("caption_scale", 1)), 0.3), 3.0)
    if caption_style and not generator.has_filter("ass"):
        return jsonify({"error":
            "your ffmpeg build has no subtitle (libass) support, so captions "
            "can't be rendered. On macOS run `brew install ffmpeg`, then make "
            "sure `which ffmpeg` points at the Homebrew binary "
            "(/opt/homebrew/bin/ffmpeg) and restart the app."}), 400
    music = []
    for m in data.get("music", []):
        if isinstance(m, str):  # bare name = whole track
            m = {"name": m}
        end = m.get("end")
        music.append({
            "path": MUSIC_DIR / secure_filename(m.get("name", "")),
            "start": max(float(m.get("start", 0)), 0),
            "end": None if end is None else float(end),
            "volume": min(max(float(m.get("volume", 1)), 0), 4),
        })

    if any(not c["path"].is_file() for c in clips):
        return jsonify({"error": "one or more selected clips no longer exist"}), 400
    if len(clips) < 1:
        return jsonify({"error": "select at least one clip"}), 400
    if not 1 <= k <= len(clips):
        return jsonify({"error": f"k must be between 1 and {len(clips)}"}), 400
    if duration <= 0:
        return jsonify({"error": "clip duration must be positive"}), 400
    if any(not m["path"].is_file() for m in music):
        return jsonify({"error": "one or more selected music tracks no longer exist"}), 400

    # captions synced to a chosen audio track live on the output timeline
    timeline_words = None
    source = data.get("caption_source") or "clips"
    if caption_style and source != "clips":
        entry = next((m for m in music if m["path"].name == source), None)
        if not entry:
            return jsonify({"error": "caption source track must be one of the "
                                     "checked music tracks"}), 400
        ac = data.get("audio_caption") or {}
        if ac.get("words"):
            end = entry["end"]
            if end is None:
                end = generator.probe_audio(entry["path"])["duration"]
            timeline_words = captions.slice_words(
                ac["words"], entry["start"], end - entry["start"])
        elif ac.get("text", "").strip():
            timeline_words = captions.words_from_text(ac["text"], k * duration)
        else:
            return jsonify({"error": "transcribe the caption track (or type "
                                     "its text) first"}), 400

    total = generator.count_permutations(len(clips), k)
    if total > HARD_CAP:
        return jsonify({"error": f"{total} outputs exceeds the hard cap of {HARD_CAP}",
                        "count": total}), 409
    if total > WARN_THRESHOLD and not data.get("confirm"):
        return jsonify({"error": f"this will generate {total} videos — resend with confirm",
                        "count": total, "needs_confirm": True}), 409

    with jobs_lock:
        running = current_job["run_id"]
        if running and not jobs[running]["finished"]:
            return jsonify({"error": "a job is already running", "run_id": running}), 429
        run_id = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
        jobs[run_id] = {"phase": "starting", "done": 0, "total": total,
                        "finished": False, "error": None, "outputs": []}
        current_job["run_id"] = run_id

    def progress(phase, done, total_steps):
        jobs[run_id].update(phase=phase, done=done, total=total_steps)

    def worker():
        try:
            outputs = generator.generate(WORKSPACE / f"run-{run_id}", clips, k,
                                         duration, progress_cb=progress,
                                         music_paths=music,
                                         caption_style=caption_style,
                                         timeline_caption_words=timeline_words,
                                         canvas=canvas,
                                         caption_scale=caption_scale)
            jobs[run_id].update(outputs=outputs, finished=True, phase="done")
        except Exception as e:  # surface any failure to the UI
            jobs[run_id].update(error=str(e), finished=True, phase="error")

    threading.Thread(target=worker, daemon=True).start()
    return jsonify({"run_id": run_id, "total": total})


@app.route("/progress/<run_id>")
def progress(run_id):
    job = jobs.get(run_id)
    if not job:
        abort(404)
    return jsonify(job)


@app.route("/outputs/<run_id>/all.zip")
def outputs_zip(run_id):
    rid = secure_filename(run_id)
    out_dir = WORKSPACE / f"run-{rid}" / "output"
    files = sorted(f for f in out_dir.iterdir() if f.is_file()) \
        if out_dir.is_dir() else []
    if not files:
        abort(404)
    # cache the zip next to the outputs; stored (uncompressed) since mp4
    # doesn't compress and this keeps it fast
    zip_path = WORKSPACE / f"run-{rid}" / "all.zip"
    if (not zip_path.is_file()
            or zip_path.stat().st_mtime < max(f.stat().st_mtime for f in files)):
        tmp = zip_path.with_suffix(".zip.part")
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_STORED) as z:
            for f in files:
                z.write(f, arcname=f"run-{rid}/{f.name}")
        tmp.replace(zip_path)
    return send_file(zip_path, as_attachment=True,
                     download_name=f"clips-{rid}.zip")


@app.route("/outputs/<run_id>/<path:filename>")
def output_file(run_id, filename):
    directory = WORKSPACE / f"run-{secure_filename(run_id)}" / "output"
    return send_from_directory(directory, filename)


if __name__ == "__main__":
    generator.check_ffmpeg()
    app.run(host="127.0.0.1", port=5000, debug=False)
