"""Caption building: Whisper transcription and styled ASS subtitle files.

Captions are burned into each clip during the normalize step, so they ride
along through every permutation at no extra encoding cost. Word timings from
transcription are relative to the full source clip; slice_words() converts
them to the trimmed window.
"""

from pathlib import Path

FONTS_DIR = Path(__file__).resolve().parent / "fonts"

_model = None


def transcribe(path):
    """Word-level transcription of a media file via faster-whisper.

    Returns {"text": full text, "words": [{"word","start","end"}]}.
    The first call downloads the model (~150 MB) to the HF cache.
    """
    global _model
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        raise RuntimeError("faster-whisper is not installed — run: "
                           "pip install faster-whisper")
    if _model is None:
        _model = WhisperModel("base", device="cpu", compute_type="int8")
    segments, _info = _model.transcribe(str(path), word_timestamps=True)
    words = []
    for seg in segments:
        for w in seg.words or []:
            words.append({"word": w.word.strip(), "start": round(w.start, 3),
                          "end": round(w.end, 3)})
    return {"text": " ".join(w["word"] for w in words), "words": words}


def slice_words(words, offset, duration):
    """Shift source-clip word timings into a trimmed window, dropping the rest."""
    out = []
    for w in words:
        if w["end"] <= offset or w["start"] >= offset + duration:
            continue
        out.append({
            "word": w["word"],
            "start": max(w["start"] - offset, 0),
            "end": min(w["end"] - offset, duration),
        })
    return out


def words_from_text(text, duration):
    """Spread typed caption text evenly across the clip window."""
    toks = text.split()
    if not toks:
        return []
    per = duration / len(toks)
    return [{"word": t, "start": i * per, "end": (i + 1) * per}
            for i, t in enumerate(toks)]


# ---------------------------------------------------------------------------

def _chunks(words, max_words=4, max_gap=1.2):
    """Group words into caption pages of a few words each."""
    out, cur = [], []
    for w in words:
        if cur and (len(cur) >= max_words or w["start"] - cur[-1]["end"] > max_gap):
            out.append(cur)
            cur = []
        cur.append(w)
    if cur:
        out.append(cur)
    return out


def _ts(t):
    t = max(t, 0)
    return f"{int(t // 3600)}:{int(t % 3600 // 60):02d}:{t % 60:05.2f}"


def _esc(word):
    return word.replace("\\", "").replace("{", "").replace("}", "")


def build_ass(words, style, res, out_path):
    """Write an ASS subtitle file for one clip window. Returns out_path or
    None when there is nothing to show."""
    if not words or style not in ("classic", "highlight", "boxed", "neon"):
        return None
    w_res, h_res = res
    fs = round(h_res * (0.085 if style == "boxed" else 0.11))
    outline = max(2, round(fs * 0.06))
    margin_v = round(h_res * 0.08)

    if style == "boxed":
        style_line = (f"Style: S,Roboto,{fs},&H00FFFFFF,&H00FFFFFF,&H00000000,"
                      f"&HA0000000,-1,0,0,0,100,100,0,0,3,{round(fs*0.25)},0,2,"
                      f"40,40,{margin_v},1")
    elif style == "neon":
        style_line = (f"Style: S,Anton,{fs},&H00FFFFFF,&H00FFFFFF,&H00B3009E,"
                      f"&H00000000,0,0,0,0,100,100,1,0,1,{outline + 2},0,2,"
                      f"40,40,{margin_v},1")
    else:  # classic, highlight
        style_line = (f"Style: S,Anton,{fs},&H00FFFFFF,&H00FFFFFF,&H00000000,"
                      f"&H80000000,0,0,0,0,100,100,1,0,1,{outline},2,2,"
                      f"40,40,{margin_v},1")

    upper = style != "boxed"
    events = []
    for chunk in _chunks(words):
        texts = [_esc(w["word"].upper() if upper else w["word"]) for w in chunk]
        start, end = chunk[0]["start"], max(chunk[-1]["end"], chunk[0]["start"] + 0.6)
        if style == "highlight":
            for i, w in enumerate(chunk):
                ev_start = w["start"] if i else start
                ev_end = chunk[i + 1]["start"] if i + 1 < len(chunk) else end
                if ev_end - ev_start < 0.05:
                    continue
                parts = []
                for j, t in enumerate(texts):
                    if j == i:
                        parts.append(r"{\c&H00D7FF&\t(0,120,\fscx118\fscy118)}"
                                     + t + r"{\r}")
                    else:
                        parts.append(t)
                events.append(f"Dialogue: 0,{_ts(ev_start)},{_ts(ev_end)},S,"
                              f",0,0,0,,{' '.join(parts)}")
        else:
            text = " ".join(texts)
            if style == "neon":
                text = r"{\blur7}" + text
            events.append(f"Dialogue: 0,{_ts(start)},{_ts(end)},S,,0,0,0,,{text}")

    if not events:
        return None
    Path(out_path).write_text(
        "[Script Info]\n"
        f"PlayResX: {w_res}\nPlayResY: {h_res}\nWrapStyle: 0\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
        "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, "
        "ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
        "Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"{style_line}\n\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, "
        "Effect, Text\n"
        + "\n".join(events) + "\n")
    return out_path
