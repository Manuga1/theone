# You're One Email Away

A scrollable slide-deck website for a 20–30 minute talk to the Waukee APEX Medical & BioScience Research group — on networking, the benefits of research, and the cold-email "you can do anything you want to do" mindset. Includes an interactive portion where students draft a cold email to a potential connection.

Plain HTML/CSS/JS — no build step, no dependencies.

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
