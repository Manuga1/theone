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
   over every output. Each track has its own timeline window: drag it to
   move, drag its edges to resize, so only that part of the track is used;
   it plays once from the start of the output (no looping — silence after
   it ends) and is cut off at the video's end if longer. The "selection
   length" box sets every track's window to an exact number of seconds at
   once; drag the windows into position afterwards. Click a track to
   preview the selection. Each track also has a volume slider (0–200%).
   The ♪ checkbox per clip keeps or drops that clip's own
   sound; "mute all clip audio" silences every clip (checked tracks still
   play).
4. Captions: pick a style (bold classic / word highlight / boxed / neon
   glow) to reveal a caption box under each clip. Type text, or hit
   "transcribe" to fill it from the clip's speech via a local Whisper model
   (first use downloads ~150 MB; needs `faster-whisper` from
   requirements.txt). Transcribed captions keep word-level timing — the
   word-highlight style pops each word as it's spoken. Editing the text
   drops the sync and spreads words evenly instead. Captions are burned
   into each clip during normalization, so they follow the clip through
   every permutation at no extra encoding cost (fonts are bundled in
   `fonts/`).
5. Generate. Outputs land in `workspace/run-<id>/output/` and are linked in
   the page when done.

## How it works

Each clip is trimmed at its chosen offset and normalized once (common
resolution with letterbox padding, 30 fps, H.264/AAC, silent audio injected
if missing or muted), then every permutation is a stream-copy concat — so
video encoding cost is O(n), not O(P(n,k)·k). With music overlays, each
output additionally gets a cheap audio-only mix pass (video still copied)
that amixes all selected track segments with the concatenated clip audio.
Runs above 500 outputs ask for confirmation; above 5000 are refused (edit
`WARN_THRESHOLD` / `HARD_CAP` in `app.py`).

Clips shorter than the requested duration are used at full length.
