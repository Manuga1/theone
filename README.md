# clip permutator

Personal local tool: give it video clips, pick how many to use per output (k)
and how long each clip should be, and it generates **every ordered permutation**
of k clips concatenated into a video. 5 clips with k=4 → 120 output videos.

## Setup

Requires Python 3 and FFmpeg on PATH. Captions need an FFmpeg built
with libass — on macOS, Homebrew's regular `ffmpeg` formula no longer
includes it, so use `brew install ffmpeg-full`. Verify with
`ffmpeg -filters | grep -w ass`.

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
2. Set k (clips per output), seconds per clip, and the output size:
   "auto" letterboxes everything onto a frame fitting all clips; the
   vertical 1080×1920 modes target Instagram/phone — "crop to fill" (the
   social-standard look) or "letterbox".
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
   glow), then choose the source. "Typed text per clip" shows a caption box
   under each clip; that text is burned into the clip and follows it
   through every permutation. Or pick one of your uploaded audio tracks —
   hit "transcribe" to run a local Whisper model on that track (never on
   clip audio; first use downloads ~150 MB, needs `faster-whisper` from
   requirements.txt) and the words appear in sync with the audio across
   the whole output, whatever order the clips are in. The word-highlight
   style pops each word as it's spoken. Editing transcript text drops the
   word sync and spreads words evenly instead. The size slider scales
   the captions (50–200%), and the preview button renders a real frame
   from your first selected clip with the caption burned in at the exact
   chosen size, style, and output mode — the preview refreshes when you
   release the slider. Audio-synced captions
   render one variant of each clip per position (n·k encodes instead of
   n), keeping concat a stream copy; clips shorter than the window shift
   later captions slightly. Caption size scales with the frame's narrow
   dimension and portrait captions sit higher, clear of Instagram's
   bottom UI. Fonts are bundled in `fonts/`.
5. Generate. Outputs land in `workspace/run-<id>/output/` and are linked in
   the page when done, along with a "download all" link that fetches the
   whole run as one zip (unzips into a `run-<id>/` folder).

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
