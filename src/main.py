"""
main.py — Generates and posts the Zerf weekly/sprint digest.
Pulls closed tasks from ClickUp (current sprint) and messages from Slack,
feeds them to Anthropic (Claude), and posts the resulting digest to a Slack channel.

Required env vars: SLACK_BOT_TOKEN, CLICKUP_API_TOKEN, ANTHROPIC_API_KEY,
                   SLACK_DIGEST_CHANNEL, CLICKUP_SPACE_MAP (or CLICKUP_SPACE_IDS),
                   SLACK_CHANNEL_GROUPS (JSON).
"""

import json
import os
import re
import time
import requests
import anthropic
from datetime import datetime, timedelta
from dotenv import load_dotenv
from sprint_resolver import get_current_sprint_lists

load_dotenv()

# ──────────────────────────────────────────────
# Constants
# ──────────────────────────────────────────────
SLACK_API   = "https://slack.com/api"
CLICKUP_API = "https://api.clickup.com/api/v2"

LOOKBACK_DAYS        = 7       # how far back to pull tasks and messages
SLACK_MSG_LIMIT      = 100     # max messages to fetch per channel
MIN_MSG_LENGTH       = 20      # ignore short messages (reactions, "ok", etc.)
MAX_MSGS_PER_CHANNEL = 20      # cap messages per channel sent to Claude
DESCRIPTION_MAX_LEN  = 300     # truncate task descriptions to this length
SLACK_CHUNK_SIZE     = 2800    # max chars per Slack message (limit is 3000)
SLACK_SEPARATOR      = "───────────────────────────"

# ClickUp statuses that count as "done" (case-insensitive)
DONE_STATUSES = ["complete", "closed", "finished"]

ANTHROPIC_MODEL      = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-20250514")
ANTHROPIC_MAX_TOKENS = 2048

# 0 = current sprint, 1 = previous sprint, 2 = two sprints ago, etc.
SPRINT_OFFSET = int(os.getenv("SPRINT_OFFSET", "0"))

# Pre-compiled regex for Markdown bold → Slack bold conversion
_BOLD_RE = re.compile(r"\*\*(.+?)\*\*")

# Pattern to extract date range from sprint names like "Sprint 20 (2/2 - 2/15)"
_SPRINT_PERIOD_RE = re.compile(r"\((\d{1,2}/\d{1,2})\s*-\s*(\d{1,2}/\d{1,2})\)")

# ──────────────────────────────────────────────
# Environment variables
# ──────────────────────────────────────────────
SLACK_TOKEN      = os.getenv("SLACK_BOT_TOKEN")
CLICKUP_TOKEN    = os.getenv("CLICKUP_API_TOKEN")
ANTHROPIC_KEY    = os.getenv("ANTHROPIC_API_KEY")
DIGEST_CHANNEL   = os.getenv("SLACK_DIGEST_CHANNEL")
# ClickUp space → project mapping (JSON). Maps project names to space IDs so
# ClickUp tasks are grouped under the same project name as Slack channels.
# Fallback: CLICKUP_SPACE_IDS=id1,id2 (tasks keyed by ClickUp list name instead).
_space_map_raw = os.getenv("CLICKUP_SPACE_MAP", "").strip()
if _space_map_raw:
    try:
        SPACE_MAP: dict[str, str] = json.loads(_space_map_raw)  # {project: space_id}
    except json.JSONDecodeError as e:
        raise SystemExit(f"CLICKUP_SPACE_MAP is not valid JSON: {e}")
    SPACE_IDS = list(SPACE_MAP.values())
else:
    SPACE_IDS = [s.strip() for s in os.getenv("CLICKUP_SPACE_IDS", "").split(",") if s.strip()]
    SPACE_MAP = {}  # no mapping — will use list names as keys

# ──────────────────────────────────────────────
# Slack channel → project grouping
# ──────────────────────────────────────────────
# Two modes, controlled by USE_SLACK_SECTIONS:
#
# ── MODE A (USE_SLACK_SECTIONS=false, default) ──────────────────────────────
# Manual mapping via SLACK_CHANNEL_GROUPS (JSON):
#   {"Project1": ["C0XXXXX1A", "C0XXXXX1B"], "Project2": ["C0XXXXX2A"]}
# Or flat list via SLACK_CHANNEL_GROUPS with one channel per project.
#
# ── MODE B (USE_SLACK_SECTIONS=true) ────────────────────────────────────────
# Auto-discovery: the bot fetches ALL channels it has access to and groups
# them by name prefix. You define the prefixes per project in
# SLACK_PROJECT_PREFIXES (JSON):
#   {"Project1": ["project1"], "Project2": ["project2a", "project2b"]}
# Any channel whose name starts with one of the prefixes (+ optional dash/underscore)
# is assigned to that project. Channels that match no prefix are skipped.
#
# ── FUTURE / IDEAL APPROACH ─────────────────────────────────────────────────
# TODO: Slack "sidebar sections" (the visual grouping in the Slack client)
# would be the cleanest way to define project → channel mapping. However,
# as of 2026-02, the Slack API does NOT expose sidebar sections — they are
# a per-user client-side feature. If Slack ever adds a public API for
# workspace-level channel sections/categories, this code should be updated
# to use that instead of prefix matching. That would let you simply organize
# channels into sections in Slack and have this script auto-discover them
# without any manual configuration.
# ─────────────────────────────────────────────────────────────────────────────
USE_SLACK_SECTIONS = os.getenv("USE_SLACK_SECTIONS", "false").lower() in ("true", "1", "yes")

# Fail fast if any required env var is missing
_required = {
    "SLACK_BOT_TOKEN": SLACK_TOKEN,
    "CLICKUP_API_TOKEN": CLICKUP_TOKEN,
    "ANTHROPIC_API_KEY": ANTHROPIC_KEY,
    "SLACK_DIGEST_CHANNEL": DIGEST_CHANNEL,
}
_missing = [k for k, v in _required.items() if not v]
if _missing:
    raise SystemExit(f"Missing required env vars: {', '.join(_missing)}  — check your .env file")

# ──────────────────────────────────────────────
# API clients / headers
# ──────────────────────────────────────────────
slack_headers    = {"Authorization": f"Bearer {SLACK_TOKEN}"}
clickup_headers  = {"Authorization": CLICKUP_TOKEN}
anthropic_client = anthropic.Anthropic(api_key=ANTHROPIC_KEY)


def _discover_channels_by_prefix() -> dict[str, list[str]]:
    """Auto-discover channel → project mapping by matching channel names to prefixes.

    Reads SLACK_PROJECT_PREFIXES from env (JSON):
      {"Authorization": ["auth"], "Tipping": ["tipping", "tip"]}

    Fetches ALL channels the bot can see and groups them by the first matching prefix.
    A channel matches a prefix if its name starts with the prefix optionally followed
    by a separator (-_) or is an exact match. E.g. prefix "auth" matches:
      auth, auth-cr, auth_dev, authorization (starts with "auth")
    """
    prefixes_raw = os.getenv("SLACK_PROJECT_PREFIXES", "").strip()
    if not prefixes_raw:
        raise SystemExit(
            "USE_SLACK_SECTIONS=true requires SLACK_PROJECT_PREFIXES in your .env.\n"
            "Example: SLACK_PROJECT_PREFIXES={\"Authorization\": [\"auth\"], \"Tipping\": [\"tipping\"]}"
        )
    try:
        project_prefixes: dict[str, list[str]] = json.loads(prefixes_raw)
    except json.JSONDecodeError as e:
        raise SystemExit(f"SLACK_PROJECT_PREFIXES is not valid JSON: {e}")

    # Fetch all channels the bot can see (public + private)
    print("Auto-discovering Slack channels by prefix...")
    all_channels = []
    cursor = None
    while True:
        params = {"limit": 200, "types": "public_channel,private_channel"}
        if cursor:
            params["cursor"] = cursor
        try:
            r = requests.get(
                f"{SLACK_API}/conversations.list",
                headers=slack_headers,
                params=params,
            )
            r.raise_for_status()
            data = r.json()
        except requests.RequestException as e:
            print(f"   ✗ Failed to list channels: {e}")
            break

        if not data.get("ok"):
            # Fall back to public only if missing_scope
            if data.get("error") == "missing_scope":
                params["types"] = "public_channel"
                try:
                    r = requests.get(f"{SLACK_API}/conversations.list", headers=slack_headers, params=params)
                    data = r.json()
                except requests.RequestException:
                    break
                if not data.get("ok"):
                    break
            else:
                break

        all_channels.extend(data.get("channels", []))
        next_cursor = data.get("response_metadata", {}).get("next_cursor")
        if not next_cursor:
            break
        cursor = next_cursor

    print(f"   Found {len(all_channels)} channels total")

    # Match channels to projects by prefix
    groups: dict[str, list[str]] = {project: [] for project in project_prefixes}
    matched_count = 0

    for ch in all_channels:
        ch_name = ch["name"].lower()
        for project, prefixes in project_prefixes.items():
            if any(ch_name.startswith(p.lower()) for p in prefixes):
                groups[project].append(ch["id"])
                matched_count += 1
                print(f"   #{ch['name']} → {project}")
                break  # first match wins

    print(f"   Matched {matched_count} channel(s) to {len(groups)} project(s)\n")

    # Remove projects with no channels
    return {p: ids for p, ids in groups.items() if ids}


# ──────────────────────────────────────────────
# Resolve CHANNEL_GROUPS based on mode
# ──────────────────────────────────────────────
if USE_SLACK_SECTIONS:
    CHANNEL_GROUPS = _discover_channels_by_prefix()
else:
    _groups_raw = os.getenv("SLACK_CHANNEL_GROUPS", "").strip()
    if _groups_raw:
        try:
            CHANNEL_GROUPS: dict[str, list[str]] = json.loads(_groups_raw)
        except json.JSONDecodeError as e:
            raise SystemExit(f"SLACK_CHANNEL_GROUPS is not valid JSON: {e}")
    else:
        raise SystemExit(
            "No Slack channel grouping configured.\n"
            "Set SLACK_CHANNEL_GROUPS (JSON) in your .env, e.g.:\n"
            '  SLACK_CHANNEL_GROUPS={"Authorization": ["C09MXSJA605"], "Tipping": ["C09873SRQBU"]}'
        )

# ─── CLICKUP ────────────────────────────────────────────────────────────────

def get_tasks_from_list(list_id: str, days: int | None = LOOKBACK_DAYS) -> list[dict]:
    """Return done tasks from a list (statuses matching DONE_STATUSES).

    Args:
        list_id: ClickUp list ID.
        days:    Only include tasks updated in the last N days.
                 Pass None to fetch ALL done tasks (useful for previous sprints).
    """
    params = {
        "include_closed": "true",
        "subtasks": "true",
    }
    if days is not None:
        since = int((datetime.now() - timedelta(days=days)).timestamp() * 1000)
        params["date_updated_gt"] = since

    try:
        r = requests.get(
            f"{CLICKUP_API}/list/{list_id}/task",
            headers=clickup_headers,
            params=params,
        )
        r.raise_for_status()
        all_tasks = r.json().get("tasks", [])

        # Filter client-side by DONE_STATUSES (case-insensitive)
        done_lower = {s.lower() for s in DONE_STATUSES}
        return [{
            "name":        t.get("name", ""),
            "status":      t.get("status", {}).get("status", ""),
            "assignees":   [a.get("username", "") for a in t.get("assignees", [])],
            "description": (t.get("description") or "")[:DESCRIPTION_MAX_LEN],
            "list_name":   t.get("list", {}).get("name", ""),
        } for t in all_tasks
          if t.get("status", {}).get("status", "").lower() in done_lower]
    except requests.RequestException as e:
        print(f"      ClickUp error fetching tasks from list {list_id}: {e}")
        return []


def extract_sprint_period(list_name: str) -> str | None:
    """Extract the date range from a sprint list name.

    E.g. "Sprint 20 (2/2 - 2/15)" → "2/2 - 2/15"
    Returns None if no date range is found.
    """
    match = _SPRINT_PERIOD_RE.search(list_name)
    return f"{match.group(1)} - {match.group(2)}" if match else None


def parse_sprint_dates(period: str) -> tuple[datetime, datetime] | None:
    """Parse a sprint period string into (start, end) datetimes.

    E.g. "2/2 - 2/15" → (datetime(2026, 2, 2), datetime(2026, 2, 15, 23, 59, 59))
    Uses the current year by default; if the end date is in the future, keeps it.
    """
    try:
        parts = period.split(" - ")
        year = datetime.now().year
        start = datetime.strptime(parts[0].strip(), "%m/%d").replace(year=year)
        end = datetime.strptime(parts[1].strip(), "%m/%d").replace(year=year)
        # If start is after end, the sprint spans a year boundary (e.g. 12/29 - 1/11)
        if start > end:
            start = start.replace(year=year - 1)
        # Include the full last day
        end = end.replace(hour=23, minute=59, second=59)
        return start, end
    except (ValueError, IndexError):
        return None


def _space_id_to_project(space_id: str) -> str | None:
    """Reverse-lookup: given a space ID, return its project name from SPACE_MAP."""
    for project, sid in SPACE_MAP.items():
        if sid == space_id:
            return project
    return None


def get_all_clickup_data(offset: int = SPRINT_OFFSET) -> tuple[dict, str | None]:
    """Iterate over configured spaces, find the target sprint in each, and collect closed tasks.

    Args:
        offset: 0 = current sprint, 1 = previous sprint, etc.

    Returns:
        (tasks_by_project, sprint_period) — sprint_period is e.g. "2/2 - 2/15" or None.
        When SPACE_MAP is configured, tasks are keyed by project name (e.g. "Authorization").
        Otherwise they fall back to ClickUp list name.
    """
    # For previous sprints, fetch ALL closed tasks (no date filter)
    # For current sprint, only fetch tasks updated in the last LOOKBACK_DAYS
    days = LOOKBACK_DAYS if offset == 0 else None

    all_data: dict[str, list[dict]] = {}
    sprint_period = None
    for space_id in SPACE_IDS:
        project_name = _space_id_to_project(space_id)
        label = f"{project_name} (space {space_id})" if project_name else f"space {space_id}"
        print(f"  Checking {label}...")
        for lst in get_current_sprint_lists(space_id, offset=offset):
            # Grab sprint period from the first list that has one
            if sprint_period is None:
                sprint_period = extract_sprint_period(lst["name"])
            tasks = get_tasks_from_list(lst["id"], days=days)
            if tasks:
                # Use project name from SPACE_MAP if available, otherwise list name
                key = project_name or lst["name"]
                all_data.setdefault(key, []).extend(tasks)
    return all_data, sprint_period

# ─── SLACK ───────────────────────────────────────────────────────────────────

def _is_human_message(msg: dict) -> bool:
    """Return True if the message is a real human message (not bot/system/too short)."""
    return (
        not msg.get("subtype")
        and not msg.get("bot_id")
        and len(msg.get("text", "").strip()) > MIN_MSG_LENGTH
    )


def get_thread_replies(channel_id: str, thread_ts: str) -> list[str]:
    """Fetch replies in a thread (excluding the parent message).

    Requires the bot to have the same channel access scopes.
    """
    try:
        r = requests.get(
            f"{SLACK_API}/conversations.replies",
            headers=slack_headers,
            params={"channel": channel_id, "ts": thread_ts, "limit": SLACK_MSG_LIMIT},
        )
        r.raise_for_status()
        data = r.json()
    except requests.RequestException:
        return []

    if not data.get("ok"):
        return []

    # First message in replies is the parent — skip it, keep only actual replies
    replies = data.get("messages", [])[1:]
    return [
        msg["text"].strip()
        for msg in replies
        if _is_human_message(msg)
    ]


def get_channel_messages(
    channel_id: str,
    days: int = LOOKBACK_DAYS,
    oldest: float | None = None,
    latest: float | None = None,
) -> list[str]:
    """Fetch human messages from a channel, including thread replies.

    Args:
        channel_id: Slack channel ID.
        days:       Fallback — fetch messages from the last N days (used when oldest/latest are None).
        oldest:     Unix timestamp for the start of the window (overrides days).
        latest:     Unix timestamp for the end of the window.
    """
    params = {
        "channel": channel_id,
        "oldest": oldest if oldest is not None else (datetime.now() - timedelta(days=days)).timestamp(),
        "limit": SLACK_MSG_LIMIT,
    }
    if latest is not None:
        params["latest"] = latest

    try:
        r = requests.get(
            f"{SLACK_API}/conversations.history",
            headers=slack_headers,
            params=params,
        )
        r.raise_for_status()
    except requests.RequestException as e:
        print(f"      Slack request failed for {channel_id}: {e}")
        return []

    data = r.json()
    if not data.get("ok"):
        print(f"      Slack API error for {channel_id}: {data.get('error')} — did you invite the bot?")
        return []

    all_msgs = data.get("messages", [])
    filtered = []
    thread_count = 0

    for msg in all_msgs:
        # Add the top-level message if it's human
        if _is_human_message(msg):
            filtered.append(msg["text"].strip())

        # If the message has a thread with replies, fetch them too
        reply_count = msg.get("reply_count", 0)
        if reply_count > 0:
            thread_count += 1
            replies = get_thread_replies(channel_id, msg["ts"])
            for reply in replies:
                filtered.append(f"  ↳ {reply}")  # indent to show it's a reply

    if thread_count > 0:
        print(f"      (+{thread_count} thread(s) expanded)")

    if len(all_msgs) > 0 and len(filtered) == 0:
        bot_count = sum(1 for m in all_msgs if m.get("bot_id"))
        sys_count = sum(1 for m in all_msgs if m.get("subtype"))
        short_count = sum(1 for m in all_msgs if not m.get("subtype") and not m.get("bot_id") and len(m.get("text", "").strip()) <= MIN_MSG_LENGTH)
        print(f"      All {len(all_msgs)} messages filtered out: {bot_count} bot, {sys_count} system, {short_count} too short (<{MIN_MSG_LENGTH} chars)")

    return filtered


def get_channel_name(channel_id: str) -> str:
    """Resolve a channel ID to its human-readable name."""
    try:
        r = requests.get(
            f"{SLACK_API}/conversations.info",
            headers=slack_headers,
            params={"channel": channel_id},
        )
        r.raise_for_status()
        return r.json().get("channel", {}).get("name", channel_id)
    except requests.RequestException:
        return channel_id  # fall back to raw ID if lookup fails


def get_all_slack_data(
    oldest: float | None = None,
    latest: float | None = None,
) -> dict:
    """Fetch messages from all configured project channels, grouped by project.

    Uses CHANNEL_GROUPS to know which channels belong to which project.
    Returns {project_name: [messages_from_all_channels]}.

    Args:
        oldest: Unix timestamp for the start of the window (optional).
        latest: Unix timestamp for the end of the window (optional).
                If both are None, falls back to LOOKBACK_DAYS.
    """
    result = {}
    for project, channel_ids in CHANNEL_GROUPS.items():
        # If the project key is a raw channel ID (backwards compat), resolve it
        project_name = project if not project.startswith("C0") else get_channel_name(project)
        print(f"   Project: {project_name}")

        project_msgs = []
        for cid in channel_ids:
            name = get_channel_name(cid)
            print(f"      Reading #{name} ({cid})...")
            msgs = get_channel_messages(cid, oldest=oldest, latest=latest)
            if msgs:
                print(f"         {len(msgs)} messages")
                project_msgs.extend(msgs)
            else:
                print("         0 messages (empty or error)")

        if project_msgs:
            print(f"      → {len(project_msgs)} total messages for {project_name}")
            result[project_name] = project_msgs
        else:
            print(f"      → 0 total messages for {project_name}")
    return result

# ─── DIGEST GENERATION ───────────────────────────────────────────────────────

def build_context(clickup_data: dict, slack_data: dict) -> str:
    """Assemble the raw context string that gets fed to the LLM."""
    parts: list[str] = []
    # Collect all project names from both sources
    all_projects = sorted(set(list(clickup_data.keys()) + list(slack_data.keys())))

    if not all_projects:
        parts.append("No data found for any project.\n")
        return "\n".join(parts)

    for project in all_projects:
        parts.append(f"## PROJECT: {project}\n")

        # ClickUp tasks for this project
        tasks = clickup_data.get(project, [])
        if tasks:
            parts.append(f"### Closed tasks ({len(tasks)}):")
            for t in tasks:
                assignees = ", ".join(t["assignees"]) or "unassigned"
                parts.append(f"- [{t['status'].upper()}] {t['name']} (assigned: {assignees})")
                if t["description"]:
                    parts.append(f"  Description: {t['description']}")
        else:
            parts.append("### Closed tasks: 0")
        parts.append("")

        # Slack messages for this project
        messages = slack_data.get(project, [])
        if messages:
            parts.append(f"### Slack messages ({len(messages)}):")
            for msg in messages[:MAX_MSGS_PER_CHANNEL]:
                parts.append(f"- {msg}")
        else:
            parts.append("### Slack messages: none")
        parts.append("")

    return "\n".join(parts)


def generate_digest(context: str, sprint_period: str | None = None) -> str:
    """Send the context to Anthropic (Claude) and return the generated digest.

    Args:
        context:       The assembled ClickUp + Slack context string.
        sprint_period: Optional date range (e.g. "2/2 - 2/15") to use in the title.
                       If None, uses today's date.
    """
    is_sprint_report = sprint_period is not None

    if is_sprint_report:
        title_date = sprint_period
        report_name = "Sprint Report"
        period_desc = f"the sprint period {sprint_period}"
    else:
        title_date = datetime.now().strftime("%Y-%m-%d")
        report_name = "Weekly Digest"
        period_desc = f"the week ending {title_date}"

    system_msg = (
        "You are the internal assistant for Zerf, a software company focused on the hospitality sector. "
        f"You generate concise, well-structured {'sprint reports' if is_sprint_report else 'weekly digests'}. "
        "You ALWAYS write in Spanish."
    )

    user_msg = f"""Your task is to generate the {report_name} for {period_desc}.

Below is the context grouped by PROJECT. Each "## PROJECT: X" block contains the closed tasks and Slack messages for that project.

{context}

IMPORTANT: The projects are ALREADY defined in the context above. Use EXACTLY those project names. Do NOT re-group, split, or merge them by feature or theme.

Generate a {report_name} in Markdown with EXACTLY this structure:

# 📋 {report_name} — {title_date}

[3-4 sentences of overview. IMPORTANT: if only ONE project has activity, say so explicitly and use less sentences — e.g. "Esta semana la actividad se concentró en el proyecto Authorization..." Do NOT write as if the whole company was involved if data only covers one project.]

---

[One section per PROJECT from the context above, separated by ---]

## 🔧 [Exact Project Name from context]

**✅ Tareas cerradas:** [total number]

---

**🚀 Avances:**
- **[Feature/theme 1]:** [1-2 sentences about what was done]
  - 👤 [Person 1], [Person 2], ...
- **[Feature/theme 2]:** [1-2 sentences about what was done]
  - 👤 [Person 1], [Person 2], ...
- **[Feature/theme 3]:** [...]
  - 👤 [Person 1], [Person 2], ...
(Group related tasks by feature/theme. Use 3-5 bullet points max. Each bullet = one area of work, not one task. Always add the people sub-item.)

---

**💡 Decisiones clave:**
- [Technical or product decisions mentioned in Slack or implied by the tasks]
- [Omit this section entirely if there are none]

---

**🚧 Bloqueos:** [one-liner, or "Sin bloqueos reportados"]

---

Rules:
- Use EXACTLY the project grouping from the context. Never invent sub-categories or split a project into multiple sections.
- Do NOT list every task individually. Group them by feature/theme into bullet points.
- Each "Avances" bullet: bolded theme name + short description, then a sub-bullet with 👤 and the people who worked on it.
- Use --- (horizontal rule) to separate each section within a project. This is critical for readability.
- If only one project has data, the overview must acknowledge that — never imply it represents the whole company.
- If there's not enough info, omit the section — never invent.
- If a project has no activity at all, skip it entirely.
- Tone: informal but professional, like a tech startup.
- Write everything in Spanish."""

    max_retries = 3
    for attempt in range(1, max_retries + 1):
        try:
            response = anthropic_client.messages.create(
                model=ANTHROPIC_MODEL,
                max_tokens=ANTHROPIC_MAX_TOKENS,
                system=system_msg,
                messages=[
                    {"role": "user", "content": user_msg},
                ],
            )
            return response.content[0].text
        except Exception as e:
            if "overloaded" in str(e).lower() and attempt < max_retries:
                wait = attempt * 10  # 10s, 20s
                print(f"   Anthropic overloaded, retrying in {wait}s (attempt {attempt}/{max_retries})...")
                time.sleep(wait)
            else:
                raise SystemExit(f"Anthropic API error: {e}")

# ─── SLACK POST ──────────────────────────────────────────────────────────────

def markdown_to_slack(text: str) -> str:
    """Convert standard Markdown to Slack mrkdwn format.
    Slack doesn't support # headers or --- rules — this converts them
    so the digest actually renders nicely in the channel.
    """
    lines = text.split("\n")
    converted = []
    for line in lines:
        # ### Header 3 → *Header 3*
        if line.startswith("### "):
            converted.append(f"*{line[4:].strip()}*")
        # ## Header 2 → *Header 2*  (bold)
        elif line.startswith("## "):
            converted.append(f"*{line[3:].strip()}*")
        # # Header 1 → *Header 1*  (bold)
        elif line.startswith("# "):
            converted.append(f"*{line[2:].strip()}*")
        # --- → visual separator that actually renders in Slack
        elif line.strip() == "---":
            converted.append(SLACK_SEPARATOR)
        else:
            # **bold** → *bold*
            converted.append(_BOLD_RE.sub(r"*\1*", line))
    return "\n".join(converted)


def post_to_slack(text: str, channel: str):
    """Post the digest to Slack, converting Markdown and splitting into
    chunks if the message exceeds Slack's char limit."""

    text = markdown_to_slack(text)

    # Split into chunks at section separators, staying under Slack's limit
    chunks = []
    while len(text) > SLACK_CHUNK_SIZE:
        # Prefer splitting at a section separator
        split_at = text[:SLACK_CHUNK_SIZE].rfind("\n" + SLACK_SEPARATOR[:3])
        if split_at == -1:
            split_at = text[:SLACK_CHUNK_SIZE].rfind("\n")
        if split_at <= 0:
            split_at = SLACK_CHUNK_SIZE  # hard cut as last resort
        chunks.append(text[:split_at])
        text = text[split_at:]
    chunks.append(text)

    for i, chunk in enumerate(chunks):
        try:
            r = requests.post(
                f"{SLACK_API}/chat.postMessage",
                headers={**slack_headers, "Content-Type": "application/json"},
                json={"channel": channel, "text": chunk, "mrkdwn": True},
            )
            r.raise_for_status()
            result = r.json()
            if not result.get("ok"):
                print(f"   Slack post error: {result.get('error')}")
            else:
                print(f"   Part {i+1}/{len(chunks)} posted")
        except requests.RequestException as e:
            print(f"   Slack post failed (part {i+1}/{len(chunks)}): {e}")

# ─── MAIN ────────────────────────────────────────────────────────────────────

def main():
    report_type = "Sprint Report" if SPRINT_OFFSET > 0 else "Weekly Digest"
    print(f"Generating Zerf {report_type}...\n")

    sprint_label = "current sprint" if SPRINT_OFFSET == 0 else f"previous sprint (offset={SPRINT_OFFSET})"
    print(f"Fetching ClickUp data ({sprint_label})...")
    clickup_data, sprint_period = get_all_clickup_data()
    total_tasks = sum(len(t) for t in clickup_data.values())
    print(f"   {total_tasks} closed tasks across {len(clickup_data)} lists")
    if sprint_period:
        print(f"   Sprint period: {sprint_period}")
    print()

    # When looking at a previous sprint, also pull Slack messages from that period
    slack_oldest, slack_latest = None, None
    if SPRINT_OFFSET > 0 and sprint_period:
        dates = parse_sprint_dates(sprint_period)
        if dates:
            slack_oldest = dates[0].timestamp()
            slack_latest = dates[1].timestamp()
            print(f"Fetching Slack messages (sprint period: {sprint_period})...")
        else:
            print("Fetching Slack messages (couldn't parse sprint dates, using last 7 days)...")
    else:
        print("Fetching Slack messages...")

    slack_data = get_all_slack_data(oldest=slack_oldest, latest=slack_latest)
    total_msgs = sum(len(m) for m in slack_data.values())
    channel_count = len(slack_data)
    print(f"   {total_msgs} message(s) across {channel_count} channel(s)\n")

    print(f"Generating {report_type.lower()} with Anthropic ({ANTHROPIC_MODEL})...")
    context = build_context(clickup_data, slack_data)
    digest = generate_digest(context, sprint_period=sprint_period if SPRINT_OFFSET > 0 else None)
    print("   Done\n")

    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    digests_dir = os.path.join(project_root, "digests")
    os.makedirs(digests_dir, exist_ok=True)
    filename = os.path.join(digests_dir, f"digest_{datetime.now().strftime('%Y-%m-%d')}.md")
    with open(filename, "w", encoding="utf-8") as f:
        f.write(digest)
    print(f"Saved locally: {filename}\n")

    print(f"Posting to Slack ({DIGEST_CHANNEL})...")
    post_to_slack(digest, DIGEST_CHANNEL)
    print(f"\nDone. Check {DIGEST_CHANNEL} in Slack.")

if __name__ == "__main__":
    main()
