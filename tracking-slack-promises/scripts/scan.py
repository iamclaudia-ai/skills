#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["slack_sdk"]
# ///
"""Find Slack threads where Michael promised something or was asked for something.

Walks every conversation the token's user belongs to (channels, private channels,
DMs, group DMs), because the user token has history scopes but no search:read.
Keeps a thread when it holds a commitment by Michael ("I'll take a look") or a
request aimed at him (a mention or a DM asking "can you..."). Threads already
decided in the ledger are skipped unless they got new replies since.

Usage:
  scan.py scan [--days 30] [--dir DIR] [--exclude NAME ...]
  scan.py record KEY STATUS [--ticket ID] [--note TEXT] [--dir DIR]
  scan.py import TRIAGE.json [--dir DIR]
  scan.py ledger [--status open] [--dir DIR]

STATUS is one of: ticketed (a Linear ticket tracks it), done (finished, nothing
to track), dismissed (not a promise or not Michael's), open (real promise, no
ticket yet: rare, prefer ticketed).
"""

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError
from slack_sdk.http_retry.builtin_handlers import RateLimitErrorRetryHandler

DEFAULT_DIR = Path.home() / "Projects/beehiiv/swarm/tmp/slack-promises"
STATUSES = {"ticketed", "done", "dismissed", "open"}

PROMISE = re.compile(
    r"\b(i['’]ll|i will|we['’]ll|we will|i can (take|look|do|get|handle|fix|check|add|help)"
    r"|let me (take a look|look|check|dig|see|get)|i['’]m on it|on it\b|will do\b"
    r"|assign (it|them|that|any tickets?)? ?to me|happy to|i['’]ll get (it|that|them)"
    r"|i['’]m going to|i['’]ll have claudia|we['’]re going to|sure[,.!]? (i|we)\b"
    r"|i can squeeze|i should have it|will (push|follow up|take|look|fix|get))",
    re.I,
)
REQUEST = re.compile(
    r"(\bcan you\b|\bcould you\b|\bwould you\b|\bwill you\b|\bplease\b|\bwhen you (get|have) a"
    r"|\bany chance\b|\bmind (taking|looking|checking)\b|\bable to\b|\bpossible to\b"
    r"|\bneed (you|your help)\b|\btake a look\b|\blook into\b|\bassign(ed)? (it |this )?to you\b|\?)",
    re.I,
)
TICKET = re.compile(r"\b[A-Z]{2,5}-\d{2,6}\b")
PR_LINK = re.compile(r"github\.com/beehiiv/[\w.-]+/pull/\d+")
DONE_HINT = re.compile(
    r"(:partymerge:|\bmerged\b|\bshipped\b|\bdeployed\b|\bfixed\b|\bresolved\b|\bdone\b|\bPR\b)", re.I
)


def client() -> WebClient:
    token = os.environ.get("SLACK_USER_TOKEN")
    if not token:
        sys.exit("SLACK_USER_TOKEN is not set (1Password Secrets vault: run render-secrets && exec zsh)")
    web = WebClient(token=token)
    web.retry_handlers.append(RateLimitErrorRetryHandler(max_retry_count=5))
    return web


def paginate(call, key, **kwargs):
    cursor = None
    while True:
        response = call(cursor=cursor, **kwargs)
        yield from response[key]
        cursor = (response.get("response_metadata") or {}).get("next_cursor")
        if not cursor:
            return


class Names:
    def __init__(self, web):
        self.web, self.cache = web, {}

    def user(self, user_id):
        if user_id not in self.cache:
            try:
                info = self.web.users_info(user=user_id)["user"]
                self.cache[user_id] = {
                    "name": info.get("real_name") or info.get("name") or user_id,
                    "bot": bool(info.get("is_bot")) or user_id == "USLACKBOT",
                }
            except SlackApiError:
                self.cache[user_id] = {"name": user_id, "bot": False}
        return self.cache[user_id]

    def text(self, text):
        text = re.sub(r"<@(U\w+)(\|[^>]*)?>", lambda m: "@" + self.user(m.group(1))["name"], text or "")
        text = re.sub(r"<#\w+\|([^>]*)>", r"#\1", text)
        text = re.sub(r"<(https?://[^|>]+)\|([^>]+)>", r"\2 (\1)", text)
        return re.sub(r"<(https?://[^>]+)>", r"\1", text)


def search_all(web, query):
    page = 1
    while True:
        response = web.search_messages(query=query, count=100, page=page, sort="timestamp")
        yield from response["messages"]["matches"]
        if page >= response["messages"]["paging"]["pages"]:
            return
        page += 1


def load_ledger(directory: Path) -> dict:
    path = directory / "ledger.json"
    return json.loads(path.read_text()) if path.exists() else {"threads": {}}


def save_ledger(directory: Path, ledger: dict):
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "ledger.json").write_text(json.dumps(ledger, indent=2, sort_keys=True) + "\n")


def stamp(ts) -> str:
    return datetime.fromtimestamp(float(ts), tz=timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M")


def conversation_label(conversation, names):
    if conversation.get("is_im"):
        return "DM with " + names.user(conversation["user"])["name"]
    if conversation.get("is_mpim"):
        return "Group DM " + conversation.get("name", conversation["id"])
    return "#" + conversation.get("name", conversation["id"])


def classify(message, me, is_direct):
    author = message.get("user")
    text = message.get("text") or ""
    if author == me and PROMISE.search(text):
        return "promise"
    if author != me and (is_direct or f"<@{me}>" in text) and REQUEST.search(text):
        return "request"
    return None


def scan(args):
    web, directory = client(), Path(args.dir)
    identity = web.auth_test()
    me, base_url = identity["user_id"], identity["url"].rstrip("/")
    names, ledger = Names(web), load_ledger(directory)
    oldest = time.time() - args.days * 86400
    excluded = {name.lstrip("#") for name in args.exclude}

    conversations = list(
        paginate(web.users_conversations, "channels", types="public_channel,private_channel,mpim,im",
                 limit=200, exclude_archived=True)
    )
    candidates, processed_keys = [], set()
    skipped_known = 0

    def consider(conversation, parent_ts, thread, is_direct, threaded, anchor):
        nonlocal skipped_known
        key = f"{conversation['id']}:{parent_ts}"
        processed_keys.add(key)
        kinds = [classify(m, me, is_direct) for m in thread]
        if not any(kinds) or (not threaded and is_direct and not classify(anchor, me, is_direct)):
            return
        last_ts = max(float(m["ts"]) for m in thread)
        known = ledger["threads"].get(key)
        if known and known["status"] != "open":
            # Only someone else's reply reopens a decided thread; Michael's own follow-up doesn't.
            newer = [m for m in thread if float(m["ts"]) > float(known.get("last_seen_ts", 0))]
            if all(m.get("user") == me for m in newer):
                skipped_known += 1
                return

        promise_positions = [i for i, kind in enumerate(kinds) if kind == "promise"]
        after_promise = thread[promise_positions[-1] + 1:] if promise_positions else []
        joined = " ".join(m.get("text") or "" for m in thread)
        candidates.append({
            "key": key,
            "where": conversation_label(conversation, names),
            "permalink": f"{base_url}/archives/{conversation['id']}/p{parent_ts.replace('.', '')}",
            "started": stamp(parent_ts),
            "last_activity": stamp(last_ts),
            "last_seen_ts": str(last_ts),
            "kinds": sorted({kind for kind in kinds if kind}),
            "michael_spoke_last": thread[-1].get("user") == me,
            "done_hint_after_promise": any(DONE_HINT.search(m.get("text") or "") for m in after_promise),
            "tickets": sorted({match.group(0) for match in TICKET.finditer(joined)}),
            "prs": sorted({"https://" + link for link in PR_LINK.findall(joined)}),
            "ledger": known,
            "messages": [
                {"who": "Michael" if m.get("user") == me else names.user(m.get("user", "?"))["name"],
                 "when": stamp(m["ts"]), "kind": kind,
                 "text": names.text(m.get("text"))[: args.max_chars]}
                for m, kind in zip(thread, kinds)
            ][-args.max_messages:],
        })

    def replies(channel_id, parent_ts):
        return [m for m in paginate(web.conversations_replies, "messages", channel=channel_id, ts=parent_ts, limit=200)
                if not m.get("bot_id")]

    for index, conversation in enumerate(conversations, 1):
        if conversation.get("is_im") and names.user(conversation["user"])["bot"]:
            continue
        if conversation.get("name") in excluded:
            continue
        print(f"\r[{index}/{len(conversations)}] {conversation_label(conversation, names)[:50]:<50}",
              end="", file=sys.stderr, flush=True)
        is_direct = bool(conversation.get("is_im") or conversation.get("is_mpim"))
        try:
            history = list(paginate(web.conversations_history, "messages", channel=conversation["id"],
                                    oldest=str(oldest), limit=200))
        except SlackApiError as error:
            print(f"\n  skip {conversation['id']}: {error.response['error']}", file=sys.stderr)
            continue
        history = [m for m in history if not m.get("bot_id") and m.get("subtype") in (None, "thread_broadcast")]
        history.sort(key=lambda m: float(m["ts"]))

        for position, message in enumerate(history):
            threaded = message.get("reply_count", 0) > 0
            involved = (message.get("user") == me or me in message.get("reply_users", [])
                        or f"<@{me}>" in (message.get("text") or "") or is_direct)
            if not involved:
                continue
            if threaded:
                thread = replies(conversation["id"], message["ts"])
            elif is_direct:
                # DMs rarely thread: a promise there sits in the flow, so keep the surrounding exchange.
                thread = history[max(0, position - 4): position + 8]
            else:
                thread = [message]
            consider(conversation, message["ts"], thread, is_direct, threaded, message)
    print(file=sys.stderr)

    # History only returns thread parents in the window, so the walk misses Michael's replies in threads that
    # started earlier and mentions of him in threads he never joined. Search finds both (needs search:read).
    by_id = {conversation["id"]: conversation for conversation in conversations}
    after = datetime.fromtimestamp(oldest).strftime("%Y-%m-%d")
    searches = ((f"from:<@{me}> after:{after}", PROMISE, True), (f"<@{me}> after:{after}", REQUEST, False))
    try:
        for query, pattern, mine in searches:
            for match in search_all(web, query):
                author = match.get("user")
                if match.get("bot_id") or not author or (author == me) != mine or names.user(author)["bot"]:
                    continue
                if not pattern.search(match.get("text") or ""):
                    continue
                channel = match["channel"]
                conversation = by_id.get(channel["id"]) or {**channel, "user": channel.get("user")}
                parent_ts = (parse_qs(urlparse(match.get("permalink", "")).query).get("thread_ts") or [match["ts"]])[0]
                if f"{channel['id']}:{parent_ts}" in processed_keys:
                    continue
                is_direct = bool(channel.get("is_im") or channel.get("is_mpim"))
                if channel.get("is_im") and not conversation.get("user"):
                    continue
                consider(conversation, parent_ts, replies(channel["id"], parent_ts), is_direct, True, match)
    except SlackApiError as error:
        if error.response["error"] != "missing_scope":
            raise
        print("search skipped: the token lacks search:read", file=sys.stderr)

    # A DM window and the threads inside it can overlap; keep one entry per key.
    unique = {candidate["key"]: candidate for candidate in candidates}
    results = sorted(unique.values(), key=lambda c: c["last_activity"], reverse=True)
    directory.mkdir(parents=True, exist_ok=True)
    run_stamp = datetime.now().strftime("%Y-%m-%d-%H%M")
    (directory / f"scan-{run_stamp}.json").write_text(json.dumps(results, indent=2) + "\n")
    report = directory / f"scan-{run_stamp}.md"
    report.write_text(render(results, args.days, skipped_known))
    ledger["last_scan"] = datetime.now().isoformat(timespec="seconds")
    save_ledger(directory, ledger)
    print(f"{len(results)} candidate threads ({skipped_known} already decided and quiet) -> {report}")


def render(results, days, skipped_known):
    lines = [f"# Slack promise scan: last {days} days", "",
             f"{len(results)} candidates, {skipped_known} already-decided threads skipped.", ""]
    for number, candidate in enumerate(results, 1):
        flags = ", ".join(candidate["kinds"])
        if candidate["michael_spoke_last"]:
            flags += ", Michael spoke last"
        if candidate["done_hint_after_promise"]:
            flags += ", done-ish words after promise"
        lines += [f"## {number}. {candidate['where']} ({candidate['last_activity']})",
                  f"key `{candidate['key']}` | {flags}", candidate["permalink"]]
        if candidate["tickets"] or candidate["prs"]:
            lines.append("refs: " + " ".join(candidate["tickets"] + candidate["prs"]))
        if candidate["ledger"]:
            lines.append(f"ledger: {candidate['ledger']['status']} {candidate['ledger'].get('ticket') or ''}")
        lines.append("")
        for message in candidate["messages"]:
            marker = {"promise": "PROMISE ", "request": "REQUEST "}.get(message["kind"], "")
            body = message["text"].replace("\n", " ")
            lines.append(f"- {marker}**{message['who']}** {message['when']}: {body}")
        lines.append("")
    return "\n".join(lines)


def record(args):
    if args.status not in STATUSES:
        sys.exit(f"status must be one of {sorted(STATUSES)}")
    directory = Path(args.dir)
    ledger = load_ledger(directory)
    entry = ledger["threads"].get(args.key, {})
    for scan_file in sorted(directory.glob("scan-*.json"), reverse=True):
        match = next((c for c in json.loads(scan_file.read_text()) if c["key"] == args.key), None)
        if match:
            entry.setdefault("permalink", match["permalink"])
            entry.setdefault("where", match["where"])
            break
    # A decision covers everything up to now (it's usually made after reading the thread's tail), so only
    # replies after this moment reopen the thread.
    entry.update(status=args.status, last_seen_ts=str(time.time()),
                 decided_at=datetime.now().isoformat(timespec="seconds"))
    if args.ticket:
        entry["ticket"] = args.ticket
    if args.note:
        entry["note"] = args.note
    ledger["threads"][args.key] = entry
    save_ledger(directory, ledger)
    print(f"{args.key} -> {args.status} {args.ticket or ''}")


VERDICT_STATUS = {"DONE": "done", "DISMISSED": "dismissed", "TRACKED": "ticketed"}


def import_triage(args):
    """Apply a triage file's verdicts: OPEN_* with a ticket become ticketed, without one stay open."""
    directory = Path(args.dir)
    ledger = load_ledger(directory)
    scanned_by_key = {}
    for scan_file in sorted(directory.glob("scan-*.json")):
        scanned_by_key.update({c["key"]: c for c in json.loads(scan_file.read_text())})
    counts = {}
    for item in json.loads(Path(args.triage).read_text()):
        ticket = item.get("existing_ticket")
        status = VERDICT_STATUS.get(item["verdict"]) or ("ticketed" if ticket else "open")
        scanned = scanned_by_key.get(item["key"], {})
        ledger["threads"][item["key"]] = {
            "status": status, "ticket": ticket, "note": item.get("title"),
            "where": item.get("where") or scanned.get("where"),
            "permalink": item.get("permalink") or scanned.get("permalink"),
            "last_seen_ts": scanned.get("last_seen_ts", "0"),
            "decided_at": datetime.now().isoformat(timespec="seconds"),
        }
        counts[status] = counts.get(status, 0) + 1
    save_ledger(directory, ledger)
    print(f"imported {sum(counts.values())}: {counts}")


def show_ledger(args):
    ledger = load_ledger(Path(args.dir))
    for key, entry in sorted(ledger["threads"].items(), key=lambda item: item[1].get("decided_at", "")):
        if args.status and entry["status"] != args.status:
            continue
        print(f"{entry['status']:<9} {entry.get('ticket') or '':<10} {(entry.get('where') or key)[:40]:<40} "
              f"{(entry.get('note') or '')[:70]}  {entry.get('permalink') or ''}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    scan_parser = sub.add_parser("scan")
    scan_parser.add_argument("--days", type=int, default=30)
    scan_parser.add_argument("--exclude", nargs="*", default=[], help="channel names to skip")
    scan_parser.add_argument("--max-messages", type=int, default=20)
    scan_parser.add_argument("--max-chars", type=int, default=700)
    record_parser = sub.add_parser("record")
    record_parser.add_argument("key")
    record_parser.add_argument("status")
    record_parser.add_argument("--ticket")
    record_parser.add_argument("--note")
    import_parser = sub.add_parser("import")
    import_parser.add_argument("triage", help="JSON array of {key, verdict, existing_ticket, title, ...}")
    ledger_parser = sub.add_parser("ledger")
    ledger_parser.add_argument("--status")
    for each in (scan_parser, record_parser, import_parser, ledger_parser):
        each.add_argument("--dir", default=str(DEFAULT_DIR))
    args = parser.parse_args()
    {"scan": scan, "record": record, "import": import_triage, "ledger": show_ledger}[args.command](args)


if __name__ == "__main__":
    main()
