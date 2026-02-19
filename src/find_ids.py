"""
find_ids.py — Utility to discover Slack channel IDs and ClickUp workspace structure.
Run this whenever you need to look up IDs for configuring the weekly-digest pipeline.
Requires SLACK_BOT_TOKEN and CLICKUP_API_TOKEN in a .env file.
"""

import requests
import os
from dotenv import load_dotenv

load_dotenv()

# ──────────────────────────────────────────────
# Constants
# ──────────────────────────────────────────────
SLACK_API   = "https://slack.com/api"
CLICKUP_API = "https://api.clickup.com/api/v2"

SLACK_PAGE_LIMIT = 200  # max channels per page (Slack caps at 200)

# ──────────────────────────────────────────────
# Slack setup
# Bot token scopes needed:
#   • channels:read  → list public channels
#   • groups:read    → list private channels the bot has been invited to
# ──────────────────────────────────────────────
headers_slack = {"Authorization": f"Bearer {os.getenv('SLACK_BOT_TOKEN')}"}


def get_all_slack_channels():
    """Fetch ALL visible channels using cursor-based pagination."""
    channels = []
    cursor = None
    channel_types = "public_channel,private_channel"

    while True:
        params = {
            "limit": SLACK_PAGE_LIMIT,
            "types": channel_types,
        }
        if cursor:
            params["cursor"] = cursor

        r = requests.get(
            f"{SLACK_API}/conversations.list",
            headers=headers_slack,
            params=params,
        )
        data = r.json()

        if not data.get("ok"):
            error = data.get("error")
            print(f"   Slack API error: {error}")
            break

        channels.extend(data.get("channels", []))

        # Cursor-based pagination: keep going while there's a next_cursor
        next_cursor = data.get("response_metadata", {}).get("next_cursor")
        if not next_cursor:
            break
        cursor = next_cursor

    return channels


# ──────────────────────────────────────────────
# Print Slack channels
# ──────────────────────────────────────────────
print("\n=== SLACK CHANNELS (all, paginated) ===")
all_channels = get_all_slack_channels()

for c in sorted(all_channels, key=lambda x: x["name"]):
    visibility = "private" if c.get("is_private") else "public"
    members = c.get("num_members", "?")
    print(f"  #{c['name']:35s} → ID: {c['id']}  ({visibility}, {members} members)")

print(f"\nTotal: {len(all_channels)} channels found")

# ──────────────────────────────────────────────
# ClickUp setup
# Needs a personal API token (v2) set as CLICKUP_API_TOKEN in .env
# ──────────────────────────────────────────────
headers_cu = {"Authorization": os.getenv("CLICKUP_API_TOKEN")}

print("\n=== CLICKUP STRUCTURE ===")

# 1. Get workspace (team)
teams = requests.get(f"{CLICKUP_API}/team", headers=headers_cu).json()
team_id = teams["teams"][0]["id"]
print(f"Team: {teams['teams'][0]['name']} (ID: {team_id})")

# 2. List spaces inside the workspace
spaces = requests.get(
    f"{CLICKUP_API}/team/{team_id}/space?archived=false",
    headers=headers_cu,
).json()

# 3. Walk spaces → folders → lists and print the full tree
for space in spaces.get("spaces", []):
    print(f"\n  Space: {space['name']} → ID: {space['id']}")

    folders = requests.get(
        f"{CLICKUP_API}/space/{space['id']}/folder?archived=false",
        headers=headers_cu,
    ).json()

    for folder in folders.get("folders", []):
        print(f"    Folder: {folder['name']:40s} → ID: {folder['id']}")

        lists = requests.get(
            f"{CLICKUP_API}/folder/{folder['id']}/list?archived=false",
            headers=headers_cu,
        ).json()

        for lst in lists.get("lists", []):
            print(f"      List: {lst['name']:35s} → ID: {lst['id']}  ({lst.get('task_count', '?')} tasks)")
