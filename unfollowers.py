#!/usr/bin/env python3
"""
Instagram non-follower finder + assisted unfollow tool.

Finds every account you follow that does NOT follow you back, then (optionally,
and only when you explicitly ask) helps you unfollow them one at a time with
human-like delays and a hard safety cap.

Usage:
    python unfollowers.py list                 # show non-followers, save CSV
    python unfollowers.py unfollow             # DRY RUN: preview what would happen
    python unfollowers.py unfollow --confirm   # actually unfollow (with approval)

Run `python unfollowers.py --help` for all options.

Read the README before your first run. Automation carries account risk;
this tool defaults to the safest behavior at every step.
"""

import argparse
import csv
import getpass
import os
import random
import sys
import time
from datetime import datetime
from pathlib import Path

try:
    from instagrapi import Client
    from instagrapi.exceptions import (
        BadPassword,
        ChallengeRequired,
        LoginRequired,
        TwoFactorRequired,
    )
except ImportError:
    sys.exit(
        "Missing dependency 'instagrapi'.\n"
        "Install it first:\n"
        "    python3 -m venv .venv && source .venv/bin/activate\n"
        "    pip install -r requirements.txt"
    )

# ---------------------------------------------------------------------------
# Paths & constants
# ---------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent
SESSION_FILE = ROOT / "session.json"
CACHE_DIR = ROOT / "cache"
REPORTS_DIR = ROOT / "reports"
WHITELIST_FILE = ROOT / "whitelist.txt"
ENV_FILE = ROOT / ".env"
DECISIONS_FILE = ROOT / "decisions.csv"  # your keep/unfollow choices + progress

# Safety defaults for the unfollow flow.
DEFAULT_MAX_UNFOLLOWS = 50      # hard cap per run
DEFAULT_MIN_DELAY = 15          # seconds between unfollows (lower bound)
DEFAULT_MAX_DELAY = 45          # seconds between unfollows (upper bound)
LONG_PAUSE_EVERY = 10           # take a longer breather every N unfollows
LONG_PAUSE_SECONDS = 120        # length of that breather


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------
def load_env():
    """Load IG_USERNAME / IG_PASSWORD from a .env file if present."""
    if not ENV_FILE.exists():
        return
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


def get_credentials():
    username = os.environ.get("IG_USERNAME") or input("Instagram username: ").strip()
    password = os.environ.get("IG_PASSWORD") or getpass.getpass("Instagram password: ")
    if not username or not password:
        sys.exit("Username and password are required.")
    return username, password


def load_whitelist():
    """Return a set of lowercased usernames that must never be unfollowed."""
    names = set()
    if WHITELIST_FILE.exists():
        for line in WHITELIST_FILE.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                names.add(line.lstrip("@").lower())
    return names


def human_delay(min_s, max_s):
    delay = random.uniform(min_s, max_s)
    print(f"   ...waiting {delay:.0f}s")
    time.sleep(delay)


# ---------------------------------------------------------------------------
# Login (with session reuse + 2FA / challenge handling)
# ---------------------------------------------------------------------------
def login():
    """
    Return an authenticated instagrapi Client.

    Order of preference:
      1. A previously saved session (session.json).
      2. A browser session cookie (IG_SESSIONID) — most reliable, avoids the
         'new device' login block Instagram throws at username/password logins.
      3. Username + password (least reliable; Instagram often rejects it as a
         suspicious new-device login).
    """
    cl = Client()
    cl.delay_range = [1, 3]  # small built-in delay between API calls
    sessionid = os.environ.get("IG_SESSIONID", "").strip()

    # 1) Reuse a saved session if we have one and it's still alive.
    if SESSION_FILE.exists():
        try:
            cl.load_settings(SESSION_FILE)
            cl.get_timeline_feed()  # cheap call to verify the session is alive
            print("Logged in using saved session.")
            return cl
        except Exception:
            print("Saved session expired — logging in fresh.")
            cl = Client()
            cl.delay_range = [1, 3]

    # 2) Preferred path: log in with a browser session cookie.
    if sessionid:
        try:
            cl.login_by_sessionid(sessionid)
            cl.dump_settings(SESSION_FILE)
            print("Logged in via browser session cookie. Saved for next time.")
            return cl
        except Exception as e:  # noqa: BLE001
            sys.exit(
                f"\nSession-cookie login failed: {e}\n"
                "The sessionid is probably wrong or expired. Grab a fresh one:\n"
                "  1. Log into instagram.com in your browser.\n"
                "  2. Copy the 'sessionid' cookie value (see the README).\n"
                "  3. Put it in .env as IG_SESSIONID=...\n"
            )

    # 3) Fallback: username + password.
    username, password = get_credentials()
    try:
        cl.login(username, password)
    except TwoFactorRequired:
        code = input("Two-factor code (from your app/SMS): ").strip()
        cl.login(username, password, verification_code=code)
    except ChallengeRequired:
        print(
            "\nInstagram issued a security challenge. Approve the login in the\n"
            "Instagram app (or check your email), then run this script again."
        )
        sys.exit(1)
    except BadPassword:
        sys.exit(
            "\nInstagram rejected the username/password login.\n"
            "This usually is NOT your password — Instagram blocks logins from\n"
            "unrecognized 'devices'. Use the browser-cookie method instead:\n"
            "  1. Log into instagram.com in your browser.\n"
            "  2. Copy the 'sessionid' cookie value (see the README).\n"
            "  3. Put it in .env as IG_SESSIONID=... and run this again.\n"
        )

    cl.dump_settings(SESSION_FILE)
    print("Logged in and saved session for next time.")
    return cl


# ---------------------------------------------------------------------------
# Data fetching
# ---------------------------------------------------------------------------
def fetch_relationships(cl, use_cache=True):
    """
    Return (following, followers) as dicts: {user_id: username}.
    Caches to disk so repeat runs don't re-hit the API.
    """
    import json

    CACHE_DIR.mkdir(exist_ok=True)
    cache_path = CACHE_DIR / f"{cl.user_id}.cache.json"

    if use_cache and cache_path.exists():
        age_min = (time.time() - cache_path.stat().st_mtime) / 60
        if age_min < 60:  # reuse cache for up to 1 hour
            data = json.loads(cache_path.read_text())
            print(f"Using cached data ({age_min:.0f} min old). "
                  f"Pass --no-cache to force a refresh.")
            return data["following"], data["followers"]

    print("Fetching who you follow... (this can take a minute for large accounts)")
    following_raw = cl.user_following(cl.user_id)
    print(f"  -> following {len(following_raw)} accounts")

    print("Fetching who follows you...")
    followers_raw = cl.user_followers(cl.user_id)
    print(f"  -> followed by {len(followers_raw)} accounts")

    following = {str(uid): u.username for uid, u in following_raw.items()}
    followers = {str(uid): u.username for uid, u in followers_raw.items()}

    cache_path.write_text(json.dumps(
        {"following": following, "followers": followers,
         "fetched_at": datetime.now().isoformat()},
        indent=2,
    ))
    return following, followers


def compute_non_followers(following, followers, whitelist):
    """Return a sorted list of (user_id, username) you follow who don't follow back."""
    follower_ids = set(followers.keys())
    result = []
    for uid, username in following.items():
        if uid in follower_ids:
            continue
        if username.lower() in whitelist:
            continue
        result.append((uid, username))
    result.sort(key=lambda x: x[1].lower())
    return result


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------
def save_csv(non_followers):
    REPORTS_DIR.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = REPORTS_DIR / f"non_followers_{stamp}.csv"
    with path.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["username", "profile_url", "user_id"])
        for uid, username in non_followers:
            writer.writerow([username, f"https://instagram.com/{username}", uid])
    return path


def print_list(non_followers):
    if not non_followers:
        print("\n🎉 Everyone you follow follows you back. Nothing to do!")
        return
    print(f"\nFound {len(non_followers)} accounts you follow that don't follow you back:\n")
    width = len(str(len(non_followers)))
    for i, (_, username) in enumerate(non_followers, 1):
        print(f"  {i:>{width}}. @{username}  ->  https://instagram.com/{username}")


# ---------------------------------------------------------------------------
# Decisions (review -> apply workflow)
# ---------------------------------------------------------------------------
DECISION_FIELDS = ["user_id", "username", "decision", "applied", "updated_at"]


def latest_report():
    """Most recent non_followers CSV, or None."""
    reports = sorted(REPORTS_DIR.glob("non_followers_*.csv"))
    return reports[-1] if reports else None


def load_decisions():
    """Return an ordered dict: user_id -> row dict."""
    from collections import OrderedDict
    decisions = OrderedDict()
    if DECISIONS_FILE.exists():
        with DECISIONS_FILE.open(newline="") as f:
            for row in csv.DictReader(f):
                decisions[row["user_id"]] = row
    return decisions


def save_decisions(decisions):
    with DECISIONS_FILE.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=DECISION_FIELDS)
        writer.writeheader()
        for row in decisions.values():
            writer.writerow(row)


def summarize_decisions(decisions):
    keep = sum(1 for r in decisions.values() if r["decision"] == "keep")
    unfollow = sum(1 for r in decisions.values() if r["decision"] == "unfollow")
    done = sum(1 for r in decisions.values()
               if r["decision"] == "unfollow" and r.get("applied") == "yes")
    print(f"\nDecisions so far: {keep} keep, {unfollow} to unfollow "
          f"({done} already unfollowed, {unfollow - done} pending).")


def cmd_review(args):
    """Go through the list fast, marking each account keep or unfollow."""
    report = latest_report()
    if not report:
        sys.exit("No list found yet. Run this first:\n    python unfollowers.py list")

    candidates = []
    with report.open(newline="") as f:
        for row in csv.DictReader(f):
            candidates.append((row["user_id"], row["username"]))

    decisions = load_decisions()
    todo = [(uid, un) for uid, un in candidates
            if args.redo or uid not in decisions]

    if not todo:
        print("Every account already has a decision.")
        summarize_decisions(decisions)
        print("\nNext: run  python unfollowers.py apply --confirm")
        return

    print("=" * 64)
    print(f"Reviewing {len(todo)} accounts (source: {report.name})")
    print("For EACH account, press one key then Enter:")
    print("   y = KEEP  (do NOT unfollow)")
    print("   n = UNFOLLOW")
    print("   s = skip for now")
    print("   q = save and quit")
    print("Your answers are saved instantly — quit and resume anytime.")
    print("=" * 64)

    now = datetime.now().isoformat(timespec="seconds")
    i = 0
    while i < len(todo):
        uid, un = todo[i]
        ans = input(f"[{i + 1}/{len(todo)}] @{un}  ->  y=keep / n=unfollow / s=skip / q=quit: ").strip().lower()
        if ans == "q":
            print("Saved. Resume later with the same command.")
            break
        if ans == "s":
            i += 1
            continue
        if ans == "y":
            decision = "keep"
        elif ans == "n":
            decision = "unfollow"
        else:
            print("   (didn't catch that — use y, n, s, or q)")
            continue
        decisions[uid] = {
            "user_id": uid, "username": un, "decision": decision,
            "applied": decisions.get(uid, {}).get("applied", "no"),
            "updated_at": now,
        }
        save_decisions(decisions)
        i += 1

    summarize_decisions(decisions)
    print("\nWhen you're ready to unfollow, run:")
    print("    python unfollowers.py apply --confirm")


def cmd_apply(args):
    """Unfollow everyone marked 'unfollow' in decisions.csv, slowly and safely."""
    decisions = load_decisions()
    if not decisions:
        sys.exit("No decisions found. Run this first:\n    python unfollowers.py review")

    pending = [r for r in decisions.values()
               if r["decision"] == "unfollow" and r.get("applied") != "yes"]
    if not pending:
        print("Nothing left to unfollow — all marked accounts are done. 🎉")
        return

    targets = pending[: args.limit]
    dry_run = not args.confirm

    print("=" * 64)
    print(f"{'DRY RUN — nothing will change.' if dry_run else 'LIVE — these accounts WILL be unfollowed.'}")
    print(f"Pending total: {len(pending)}  |  This run: {len(targets)} (cap {args.limit})")
    print(f"Delay between unfollows: {args.min_delay}-{args.max_delay}s, "
          f"with a {args.long_pause}s pause every {LONG_PAUSE_EVERY}.")
    print("=" * 64)

    cl = login() if not dry_run else None
    now_fn = lambda: datetime.now().isoformat(timespec="seconds")
    done = failed = 0

    for i, row in enumerate(targets, 1):
        uid, un = row["user_id"], row["username"]
        prefix = f"[{i}/{len(targets)}]"

        if dry_run:
            print(f"{prefix} [dry] would unfollow @{un}")
            done += 1
            continue

        try:
            cl.user_unfollow(uid)
            row["applied"] = "yes"
            row["updated_at"] = now_fn()
            decisions[uid] = row
            save_decisions(decisions)
            done += 1
            print(f"{prefix} ✓ unfollowed @{un}   ({done} this run)", flush=True)
        except Exception as e:  # noqa: BLE001
            msg = str(e).lower()
            row["applied"] = "failed"
            row["updated_at"] = now_fn()
            decisions[uid] = row
            save_decisions(decisions)
            failed += 1
            print(f"{prefix} ✗ @{un}: {e}", flush=True)
            if any(s in msg for s in
                   ("feedback_required", "rate", "wait", "429",
                    "login_required", "challenge", "checkpoint")):
                print("\n⚠️  Instagram is rate-limiting or the session died. "
                      "Stopping now to protect your account.", flush=True)
                break

        if i < len(targets):
            if done and done % LONG_PAUSE_EVERY == 0:
                print(f"   ...long pause {args.long_pause}s", flush=True)
                time.sleep(args.long_pause)
            else:
                human_delay(args.min_delay, args.max_delay)

    verb = "would be unfollowed" if dry_run else "unfollowed"
    remaining = len([r for r in decisions.values()
                     if r["decision"] == "unfollow" and r.get("applied") != "yes"])
    print("\n" + "-" * 64)
    print(f"Done this run: {done} {verb}, {failed} failed. {remaining} still pending.")
    if not dry_run and remaining:
        print("Run the same command again (a fresh cookie may be needed) to continue.")


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------
def cmd_list(args):
    cl = login()
    following, followers = fetch_relationships(cl, use_cache=not args.no_cache)
    whitelist = load_whitelist()
    non_followers = compute_non_followers(following, followers, whitelist)
    print_list(non_followers)
    if non_followers:
        path = save_csv(non_followers)
        print(f"\nSaved list to: {path}")


def cmd_unfollow(args):
    cl = login()
    following, followers = fetch_relationships(cl, use_cache=not args.no_cache)
    whitelist = load_whitelist()
    non_followers = compute_non_followers(following, followers, whitelist)

    print_list(non_followers)
    if not non_followers:
        return

    save_csv(non_followers)

    # Respect the per-run cap.
    targets = non_followers[: args.limit]
    dry_run = not args.confirm

    print("\n" + "=" * 60)
    if dry_run:
        print("DRY RUN — no one will be unfollowed. Add --confirm to act for real.")
    else:
        print("LIVE MODE — accounts you approve WILL be unfollowed.")
    print(f"Candidates this run: {len(targets)} (cap: {args.limit})")
    print(f"Delay between unfollows: {args.min_delay}-{args.max_delay}s")
    print("=" * 60)

    if not dry_run and not args.yes:
        ans = input(
            f"\nProceed to review {len(targets)} accounts for unfollowing? [y/N] "
        ).strip().lower()
        if ans != "y":
            print("Aborted. Nothing was changed.")
            return

    unfollowed = 0
    skipped = 0
    for i, (uid, username) in enumerate(targets, 1):
        prefix = f"[{i}/{len(targets)}] @{username}"

        if args.yes:
            approve = True
        else:
            choice = input(
                f"{prefix} — unfollow? [y]es / [n]o / [q]uit: "
            ).strip().lower()
            if choice == "q":
                print("Stopping here.")
                break
            approve = choice == "y"

        if not approve:
            print(f"   skipped @{username}")
            skipped += 1
            continue

        if dry_run:
            print(f"   [dry run] would unfollow @{username}")
            unfollowed += 1
        else:
            try:
                cl.user_unfollow(uid)
                print(f"   ✓ unfollowed @{username}")
                unfollowed += 1
            except Exception as e:  # noqa: BLE001 - surface any API error, keep going
                print(f"   ✗ failed to unfollow @{username}: {e}")
                skipped += 1

        # Pace ourselves (skip the wait after the final action).
        if i < len(targets):
            if not dry_run and unfollowed and unfollowed % LONG_PAUSE_EVERY == 0:
                print(f"   Taking a {LONG_PAUSE_SECONDS}s breather to stay under the radar...")
                time.sleep(LONG_PAUSE_SECONDS)
            elif not dry_run:
                human_delay(args.min_delay, args.max_delay)

    print("\n" + "-" * 60)
    verb = "would be unfollowed" if dry_run else "unfollowed"
    print(f"Done. {unfollowed} {verb}, {skipped} skipped.")
    if dry_run:
        print("This was a DRY RUN. Re-run with --confirm to actually unfollow.")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def build_parser():
    p = argparse.ArgumentParser(
        description="Find (and optionally unfollow) Instagram accounts that "
                    "don't follow you back.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = p.add_subparsers(dest="command", required=True)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument(
        "--no-cache", action="store_true",
        help="Ignore cached data and re-fetch from Instagram.",
    )

    p_list = sub.add_parser(
        "list", parents=[common],
        help="Show accounts that don't follow you back and save a CSV.",
    )
    p_list.set_defaults(func=cmd_list)

    p_unf = sub.add_parser(
        "unfollow", parents=[common],
        help="Assisted unfollow flow (dry run by default).",
    )
    p_unf.add_argument(
        "--confirm", action="store_true",
        help="Actually unfollow. Without this it's a DRY RUN.",
    )
    p_unf.add_argument(
        "--yes", action="store_true",
        help="Skip the per-account prompt and auto-approve every candidate "
             "(still respects --limit and delays). Use with care.",
    )
    p_unf.add_argument(
        "--limit", type=int, default=DEFAULT_MAX_UNFOLLOWS,
        help=f"Max accounts to process this run (default {DEFAULT_MAX_UNFOLLOWS}).",
    )
    p_unf.add_argument(
        "--min-delay", type=float, default=DEFAULT_MIN_DELAY,
        help=f"Min seconds between unfollows (default {DEFAULT_MIN_DELAY}).",
    )
    p_unf.add_argument(
        "--max-delay", type=float, default=DEFAULT_MAX_DELAY,
        help=f"Max seconds between unfollows (default {DEFAULT_MAX_DELAY}).",
    )
    p_unf.set_defaults(func=cmd_unfollow)

    # review: mark keep/unfollow for the whole list, fast and offline.
    p_rev = sub.add_parser(
        "review",
        help="Go through the list marking each account keep (y) or unfollow (n). "
             "Saves your answers to decisions.csv.",
    )
    p_rev.add_argument(
        "--redo", action="store_true",
        help="Re-review accounts you've already decided on (start over).",
    )
    p_rev.set_defaults(func=cmd_review)

    # apply: execute the unfollows you marked, slowly. Good for background runs.
    p_app = sub.add_parser(
        "apply",
        help="Unfollow everyone you marked 'unfollow' during review. "
             "Dry run unless --confirm. Resumable; safe to run in the background.",
    )
    p_app.add_argument(
        "--confirm", action="store_true",
        help="Actually unfollow. Without this it's a DRY RUN.",
    )
    p_app.add_argument(
        "--limit", type=int, default=150,
        help="Max unfollows this run (default 150 — a sane nightly ceiling).",
    )
    p_app.add_argument(
        "--min-delay", type=float, default=30,
        help="Min seconds between unfollows (default 30).",
    )
    p_app.add_argument(
        "--max-delay", type=float, default=60,
        help="Max seconds between unfollows (default 60).",
    )
    p_app.add_argument(
        "--long-pause", type=float, default=300,
        help=f"Seconds to pause every {LONG_PAUSE_EVERY} unfollows (default 300).",
    )
    p_app.set_defaults(func=cmd_apply)
    return p


def main():
    load_env()
    parser = build_parser()
    args = parser.parse_args()
    try:
        args.func(args)
    except KeyboardInterrupt:
        print("\nInterrupted. Nothing further will be changed.")
        sys.exit(130)


if __name__ == "__main__":
    main()
