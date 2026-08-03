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

1. Upload clips (stored in `workspace/uploads/`). Each clip shows its
   duration and a timeline; **drag the blue window** to pick exactly which
   part of the clip gets used (click a track to preview that segment).
   The "position windows" buttons are presets: all at start / centered /
   randomized.
2. Set k (clips per output) and seconds per clip.
3. Audio: optionally upload music tracks — every checked track is layered
   over every output (each looped if shorter than the video). The ♪
   checkbox per clip keeps or drops that clip's own sound; "mute all clip
   audio" silences every clip (checked tracks still play).
4. Generate. Outputs land in `workspace/run-<id>/output/` and are linked in
   the page when done.

## How it works

Each clip is trimmed at its chosen offset and normalized once (common
resolution with letterbox padding, 30 fps, H.264/AAC, silent audio injected
if missing or muted), then every permutation is a stream-copy concat — so
video encoding cost is O(n), not O(P(n,k)·k). With music overlays, each
output additionally gets a cheap audio-only mix pass (video still copied)
that amixes all selected tracks with the concatenated clip audio.
Runs above 500 outputs ask for confirmation; above 5000 are refused (edit
`WARN_THRESHOLD` / `HARD_CAP` in `app.py`).

Clips shorter than the requested duration are used at full length.
