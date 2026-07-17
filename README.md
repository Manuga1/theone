# Instagram Non-Follower Finder + Assisted Unfollow

A Python CLI that finds **every account you follow that doesn't follow you back**,
then optionally helps you unfollow them — one at a time, with human-like delays
and a hard safety cap.

Built to default to the *safest* behavior at every step.

---

## ⚠️ Read this first (account risk)

Any tool that automates Instagram violates its Terms of Service and carries
some risk to your account. Bulk or fast unfollowing is exactly what Instagram's
systems flag. This tool minimizes that risk, but cannot eliminate it. Use it on
an account you can afford to have temporarily action-blocked, go slow, and stop
if Instagram shows you a "Try again later" / action-blocked message.

Safety features built in:

- **Dry run by default** — `unfollow` previews and changes nothing until you add `--confirm`.
- **Per-account approval** — you say yes/no to each account (unless you opt out).
- **Hard cap per run** — default **50** unfollows max (`--limit`).
- **Randomized delays** — 15–45s between actions, plus a 2-min breather every 10.
- **Whitelist** — accounts in `whitelist.txt` are never touched.
- **Session reuse** — logs in once and caches the session to avoid tripping
  repeated login challenges.

---

## Setup (macOS)

You'll need Python 3. Check with `python3 --version`. If it's missing, install
from [python.org](https://www.python.org/downloads/) or via Homebrew
(`brew install python`).

```bash
# 1. Go into the project folder
cd theone

# 2. Create an isolated environment and activate it
python3 -m venv .venv
source .venv/bin/activate

# 3. Install the one dependency
pip install -r requirements.txt

# 4. Add your credentials
cp .env.example .env
# then open .env in a text editor and fill in IG_USERNAME / IG_PASSWORD
```

Your `.env`, saved session, cached data, and CSV reports are all **git-ignored**
— they never leave your machine.

> Prefer not to store your password in a file? Skip step 4 and the script will
> prompt you for your username and password each run.

---

## Usage

### 1. Just see who doesn't follow you back

```bash
python unfollowers.py list
```

Prints a numbered list with profile links and saves a timestamped CSV to
`reports/`.

### 2. Assisted unfollow — preview (safe, no changes)

```bash
python unfollowers.py unfollow
```

This is a **dry run**. It shows exactly what *would* happen and touches nothing.

### 3. Assisted unfollow — for real

```bash
python unfollowers.py unfollow --confirm
```

You'll be asked `y/n/q` for each account. It stops after `--limit` (default 50)
and paces itself between actions.

---

## Common options

```bash
# Process at most 20 accounts this run
python unfollowers.py unfollow --confirm --limit 20

# Auto-approve every candidate (no per-account prompt) — still capped & delayed
python unfollowers.py unfollow --confirm --yes --limit 20

# Go slower (safer): 30–90s between unfollows
python unfollowers.py unfollow --confirm --min-delay 30 --max-delay 90

# Force fresh data instead of the (up to 1 hr) cache
python unfollowers.py list --no-cache
```

See everything with `python unfollowers.py unfollow --help`.

---

## Whitelist

Open `whitelist.txt` and add one username per line (without the `@`) for anyone
you never want to unfollow, even if they don't follow you back. Matching is
case-insensitive.

```
nasa
natgeo
my_best_friend
```

---

## Logging in with a session cookie (recommended)

Instagram frequently blocks username/password logins from scripts, treating
them as suspicious "new device" logins (you'll see a `BadPassword` / 400 error
even when the password is correct). The reliable way around this is to log in
through your browser — which Instagram trusts — and hand the script the
resulting session cookie.

**How to get your `sessionid`:**

1. In **Chrome** (or Safari/Firefox) on your computer, go to
   [instagram.com](https://www.instagram.com) and log in normally.
2. Open the developer tools:
   - **Chrome:** View → Developer → Developer Tools, then click the
     **Application** tab.
   - **Safari:** enable Develop menu (Settings → Advanced → "Show Develop menu"),
     then Develop → Show Web Inspector → **Storage** tab.
3. In the left sidebar, expand **Cookies** → click **https://www.instagram.com**.
4. Find the row named **`sessionid`** and copy its **Value** (a long string like
   `71234567%3AAbCdEf...`).
5. Put it in your `.env` file:

   ```
   IG_SESSIONID=paste_the_value_here
   ```

6. Run the script as normal:

   ```bash
   python unfollowers.py list
   ```

That's it — no password needed, and no new-device block. The session is cached
locally so you only do this occasionally (re-grab a fresh `sessionid` if you get
logged out).

> Keep your `sessionid` private — anyone with it can access your account. It
> lives only in your git-ignored `.env` file.

---

## Two-factor auth & security challenges

- **2FA on:** the script will prompt for your one-time code.
- **Security challenge:** if Instagram asks you to confirm the login, approve it
  in the Instagram app (or via the email it sends), then run the command again.
  The saved session means you usually only do this once.

---

## Recommended workflow (lowest risk)

1. Run `list` and skim it. Add anyone you want to keep to `whitelist.txt`.
2. Run `unfollow` (dry run) to preview.
3. Run `unfollow --confirm --limit 20` and approve accounts by hand.
4. Do a batch, then come back another day for the next batch. Slow and steady
   keeps you off Instagram's radar.

---

## Files

| File                | What it is                                              |
|---------------------|---------------------------------------------------------|
| `unfollowers.py`    | The CLI tool.                                            |
| `requirements.txt`  | The single dependency (`instagrapi`).                   |
| `.env`              | Your credentials (git-ignored — you create this).       |
| `whitelist.txt`     | Accounts to never unfollow.                             |
| `session.json`      | Cached login session (git-ignored, auto-created).       |
| `cache/`            | Cached follower/following data (git-ignored).           |
| `reports/`          | Timestamped CSV exports (git-ignored).                  |

---

*This tool is for managing your own account. Respect Instagram's rate limits and
other people's presence on the platform.*
