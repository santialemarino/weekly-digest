# Zerf Weekly Digest

Automated sprint/weekly report generator for **Zerf**. Pulls closed tasks from ClickUp and messages from Slack, feeds them to Anthropic (Claude), and posts the resulting digest to a Slack channel.

## Setup

1. **Create a virtual environment and install dependencies:**
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   pip install requests python-dotenv anthropic
   ```

2. **Create a `.env` file** with the required variables:
   ```env
   SLACK_BOT_TOKEN=xoxb-...
   CLICKUP_API_TOKEN=pk_...
   ANTHROPIC_API_KEY=sk-ant-...
   SLACK_DIGEST_CHANNEL=C0XXXXXXX

   # Maps project names to ClickUp space IDs (JSON)
   CLICKUP_SPACE_MAP={"Project1": "C0XXXXX1A", "Project2": "C0XXXXX2A"}

   # Maps project names to Slack channel IDs (JSON)
   SLACK_CHANNEL_GROUPS={"Authorization": ["C0XXXXX1A", "C0XXXXX1B"], "Project2": ["C0XXXXX1B", "C099LQSLMLM"]}
   ```

3. **Alternative: auto-discover channels by prefix:**
   ```env
   USE_SLACK_SECTIONS=true
   SLACK_PROJECT_PREFIXES={"Project1": ["project1"], "Project2": ["project2a", "project2b"]}
   ```

### Slack Bot Scopes

`channels:read`, `channels:history`, `groups:read`, `groups:history`, `chat:write`

## Usage

```bash
# Current weekly digest
python src/main.py

# Previous sprint report
SPRINT_OFFSET=1 python src/main.py
```

The digest is saved to `digests/` and posted to the configured Slack channel.

## Files

| File | Purpose |
|---|---|
| `src/main.py` | Core pipeline: fetch data → generate digest → post to Slack |
| `src/sprint_resolver.py` | Resolves current/previous sprint lists from ClickUp |
| `src/find_ids.py` | Utility to discover Slack channel IDs and ClickUp workspace structure |

## Optional env vars

| Variable | Default | Description |
|---|---|---|
| `SPRINT_OFFSET` | `0` | `0` = current sprint, `1` = previous, etc. |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-20250514` | Model to use for generation |
| `USE_SLACK_SECTIONS` | `false` | Enable auto-discovery of channels by prefix |
| `SLACK_PROJECT_PREFIXES` | — | JSON: project names → channel name prefixes |
