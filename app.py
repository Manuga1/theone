"""Minimal local web app for generating clip permutations. Personal use only.

Run: python app.py  ->  http://localhost:5000
"""

import threading
import time
import uuid
from pathlib import Path

from flask import Flask, abort, jsonify, render_template, request, send_from_directory
from werkzeug.utils import secure_filename

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
        clips.append({
            "path": UPLOADS / name,
            "offset": max(float(c.get("offset", 0)), 0),
            "audio": bool(c.get("audio", True)) and not data.get("mute_all"),
        })
    k = int(data.get("k", 0))
    duration = float(data.get("duration", 0))
    music = [MUSIC_DIR / secure_filename(n) for n in data.get("music", [])]

    if any(not c["path"].is_file() for c in clips):
        return jsonify({"error": "one or more selected clips no longer exist"}), 400
    if len(clips) < 1:
        return jsonify({"error": "select at least one clip"}), 400
    if not 1 <= k <= len(clips):
        return jsonify({"error": f"k must be between 1 and {len(clips)}"}), 400
    if duration <= 0:
        return jsonify({"error": "clip duration must be positive"}), 400
    if any(not m.is_file() for m in music):
        return jsonify({"error": "one or more selected music tracks no longer exist"}), 400

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
                                         music_paths=music)
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


@app.route("/outputs/<run_id>/<path:filename>")
def output_file(run_id, filename):
    directory = WORKSPACE / f"run-{secure_filename(run_id)}" / "output"
    return send_from_directory(directory, filename)


if __name__ == "__main__":
    generator.check_ffmpeg()
    app.run(host="127.0.0.1", port=5000, debug=False)
