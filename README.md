# clip permutator

Personal local tool: give it video clips, pick how many to use per output (k)
and how long each clip should be, and it generates **every ordered permutation**
of k clips concatenated into a video. 5 clips with k=4 → 120 output videos.

## Setup

Requires Python 3 and FFmpeg on PATH.

```
pip install -r requirements.txt
python app.py
```

Open http://localhost:5000.

## Usage

1. Upload clips (stored in `workspace/uploads/`).
2. Set k (clips per output), seconds per clip, and trim style
   (start / center / random window of each clip).
3. Generate. Outputs land in `workspace/run-<id>/output/` and are linked in
   the page when done.

## How it works

Each clip is trimmed and normalized once (common resolution with letterbox
padding, 30 fps, H.264/AAC, silent audio injected if missing), then every
permutation is a stream-copy concat — so encoding cost is O(n), not
O(P(n,k)·k). Runs above 500 outputs ask for confirmation; above 5000 are
refused (edit `WARN_THRESHOLD` / `HARD_CAP` in `app.py`).

Clips shorter than the requested duration are used at full length.
