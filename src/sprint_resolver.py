"""
sprint_resolver.py — Finds the current (latest) sprint folder in a ClickUp space
and returns its lists. Used by the weekly-digest pipeline to know which
ClickUp lists to pull tasks from.

Requires CLICKUP_API_TOKEN in .env.
Looks for folders containing "Sprint Folder" or "Development" in the name.
"""

import requests
import re
import os
from dotenv import load_dotenv

load_dotenv()

# ──────────────────────────────────────────────
# Constants
# ──────────────────────────────────────────────
CLICKUP_API = "https://api.clickup.com/api/v2"

# Folder names must contain one of these keywords to be considered sprint folders
SPRINT_FOLDER_KEYWORDS = ["Sprint Folder", "Development"]

# Pattern to extract the sprint/week number from a list name
# Matches: "Sprint 1 (…)", "Week 3 (…)", "Sprint-12", etc.
LIST_NUMBER_PATTERN = re.compile(r"(?:Sprint|Week)\s*[_\-]?\s*(\d+)", re.IGNORECASE)

# ──────────────────────────────────────────────
# ClickUp setup
# ──────────────────────────────────────────────
headers_cu = {"Authorization": os.getenv("CLICKUP_API_TOKEN")}


def get_current_sprint_lists(space_id: str, offset: int = 0) -> list[dict]:
    """Find folders matching SPRINT_FOLDER_KEYWORDS in the given space,
    then return the Nth-highest-numbered list from each.

    Args:
        space_id: ClickUp space ID to search.
        offset:   0 = current (latest) sprint, 1 = previous sprint, 2 = two sprints ago, etc.
    """

    # Fetch all (non-archived) folders in the space
    try:
        r = requests.get(
            f"{CLICKUP_API}/space/{space_id}/folder?archived=false",
            headers=headers_cu,
        )
        r.raise_for_status()
        folders_resp = r.json()
    except requests.RequestException as e:
        print(f"   ClickUp error fetching folders for space {space_id}: {e}")
        return []

    folders = folders_resp.get("folders", [])

    # Filter folders whose name contains any of the keywords
    sprint_folders = [
        f for f in folders
        if any(kw.lower() in f["name"].lower() for kw in SPRINT_FOLDER_KEYWORDS)
    ]

    if not sprint_folders:
        print(f"   No sprint folders found in space {space_id}")
        print(f"      Looking for folders containing: {SPRINT_FOLDER_KEYWORDS}")
        print(f"      Found folders: {[f['name'] for f in folders]}")
        return []

    all_current_lists = []

    for folder in sprint_folders:
        print(f"   Sprint folder: {folder['name']} (ID: {folder['id']})")

        # Fetch lists inside this folder.
        # ClickUp's archived param is a filter (true = only archived, false = only active),
        # so when looking at previous sprints we need both calls to cover all lists.
        try:
            r = requests.get(
                f"{CLICKUP_API}/folder/{folder['id']}/list?archived=false",
                headers=headers_cu,
            )
            r.raise_for_status()
            lists = r.json().get("lists", [])

            # Also fetch archived lists when looking for previous sprints
            if offset > 0:
                r2 = requests.get(
                    f"{CLICKUP_API}/folder/{folder['id']}/list?archived=true",
                    headers=headers_cu,
                )
                r2.raise_for_status()
                archived = r2.json().get("lists", [])
                if archived:
                    print(f"      (+{len(archived)} archived list(s))")
                lists.extend(archived)
        except requests.RequestException as e:
            print(f"      ClickUp error fetching lists for folder {folder['id']}: {e}")
            continue

        if not lists:
            print("      No lists found")
            continue

        # Find all numbered lists and sort descending (highest = most recent)
        numbered_lists = []
        for lst in lists:
            match = LIST_NUMBER_PATTERN.search(lst["name"])
            if match:
                numbered_lists.append((int(match.group(1)), lst))

        if not numbered_lists:
            print("      No numbered sprint/week lists found")
            print(f"      Available lists: {[lst['name'] for lst in lists]}")
            continue

        numbered_lists.sort(key=lambda x: x[0], reverse=True)
        print(f"      Found {len(numbered_lists)} sprint(s): {[name for _, name in [(n, li['name']) for n, li in numbered_lists]]}")

        if offset >= len(numbered_lists):
            print(f"      ✗ Not enough sprints for offset={offset} (only {len(numbered_lists)} found)")
            continue

        _, selected_list = numbered_lists[offset]
        label = "Current" if offset == 0 else f"Previous (offset={offset})"
        print(f"      {label}: {selected_list['name']} (list ID: {selected_list['id']})")
        all_current_lists.append(selected_list)

    return all_current_lists
