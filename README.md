# You're One Email Away

A scrollable slide-deck website for a 20–30 minute talk to the Waukee APEX Medical & BioScience Research group — on networking, the benefits of research, and the cold-email "you can do anything you want to do" mindset. Includes an interactive portion where students draft a cold email to a potential connection.

Plain HTML/CSS/JS — no build step. Three.js (MIT, vendored in `vendor/`) powers the scroll-driven 3D brain background: a stylized neural point-cloud brain that assembles on load, rotates as you scroll, and breaks apart into anatomical parts on section dividers and the closing slide. A `mix-blend-mode: difference` custom cursor inverts whatever it passes over (desktop only), and the timeline slide temporarily turns vertical scrolling into a horizontal card ride from APEX to Vanderbilt sophomore year before the page resumes downward.

The design follows Apple-style scrollytelling principles: neutral Inter typography with heavy weight/scale contrast, borderless whitespace-divided sections, radial "studio lighting," a scroll-linked light→obsidian background bleed into the dark "Pro" act (networking) and finale, a pinned showcase section where the brain is scrubbed deterministically by scroll position (reverse scrolling rebuilds it backward) behind an interlocking ghost headline with a reading-spotlight feature list, low-opacity focus dimming on the timeline cards, and GPU-only animation (`transform`/`opacity` exclusively).

## Presenting

- **Scroll** or use **↑ / ↓** (also PgUp/PgDn, Space) to move slide by slide
- Click the **dots** on the right to jump to any slide
- Press **N** to toggle speaker notes (talking points + timing cues on every slide)
- Works on phones too — students can open the URL during the activity

## Run locally

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

(or `npx serve`, or just open `index.html` in a browser)

## Deploy to Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and import this repository
2. Framework preset: **Other** — leave build command and output directory empty
3. Deploy. That's it — Vercel serves the static files from the repo root.

Every push to the connected branch redeploys automatically.

## Editing content

All slide content lives in `index.html` (one `<section class="slide">` per slide, with a hidden `<div class="notes">` for speaker notes). Styling is in `styles.css`, navigation/animation logic in `app.js`.
