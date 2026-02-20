# Zerf Weekly Digest

Automated sprint/weekly report generator for **Zerf**. Pulls closed tasks from ClickUp and messages from Slack, feeds them to Anthropic (Claude), and posts the resulting digest to the selected channels, using the selected tone, with the selected format.

## Setup

1. **Enable corepack** (if not already):
   ```bash
   corepack enable
   ```

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

3. **Create a `.env` file** with the required variables (see below).

4. **Discover IDs** for your Slack channels, users, and ClickUp spaces:
   ```bash
   pnpm find-ids
   ```

5. **Run the digest:**
   ```bash
   pnpm dev
   ```

### Slack Bot Scopes

`channels:read` · `channels:history` · `groups:read` · `groups:history` · `chat:write` · `users:read` · `im:write`

## Environment Variables

### Required

| Variable | Description |
|---|---|
| `SLACK_BOT_TOKEN` | Slack Bot OAuth token (`xoxb-...`) |
| `CLICKUP_API_TOKEN` | ClickUp personal API token |
| `ANTHROPIC_API_KEY` | Anthropic API key (`sk-ant-...`) |
| `SLACK_DIGEST_CHANNEL` | Channel where the digest is posted (e.g. `"#weekly-digest"`) |
| `CLICKUP_SPACE_MAP` | JSON mapping project names → ClickUp space IDs |
| `SLACK_CHANNEL_GROUPS` | JSON mapping project names → Slack channel IDs |

Example:
```env
CLICKUP_SPACE_MAP={"Project1": "C0CXXXX1A", "Project2": "C0CXXXX2A"}
SLACK_CHANNEL_GROUPS={"Project1": ["C0SXXXX1A", "C0SXXXX1B"], "Project2": ["C0SXXXX2A", "C0SXXXX2B"]}
```

### Optional

| Variable | Default | Description |
|---|---|---|
| `REPORT_LANG` | `es` | Report language: `es` (Spanish) or `en` (English) |
| `SPRINT_OFFSET` | `0` | `0` = current sprint, `1` = previous, `2` = two ago, etc. |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-20250514` | Claude model to use for generation |
| `USE_SLACK_SECTIONS` | `false` | Auto-discover Slack channels by name prefix (see below) |
| `SLACK_PROJECT_PREFIXES` | — | Required if `USE_SLACK_SECTIONS=true`. JSON: project → prefixes |
| `LOG_LEVEL` | `info` | Logger verbosity: `trace`, `debug`, `info`, `warn`, `error`, `fatal` |

### Tone

Two tones control the writing style of the generated report:

| Tone | Description |
|---|---|
| `informal` | Casual, emoji-rich, teammate-friendly (default for Slack) |
| `formal` | Polished, professional, no emojis — ideal for clients/stakeholders (default for email) |

Each output driver has its own tone setting (see Output drivers). Only the tones that are actually needed are generated (if all drivers use `informal`, only 1 Anthropic call is made).

### Output drivers

Control where the digest is delivered. All are independent and can be combined.

| Variable | Default | Description |
|---|---|---|
| `OUTPUT_LOCAL_FILE` | `true` | Save digest to `digests/` |
| `OUTPUT_LOCAL_FILE_FORMATS` | `md,html,json,txt,pdf` | Which formats to save (comma-separated) |
| `OUTPUT_LOCAL_FILE_TONE` | `informal` | Tone for local files. Set to `all` to save both tones in sub-folders |
| `OUTPUT_SLACK_CHANNEL` | `true` | Post to `SLACK_DIGEST_CHANNEL` |
| `OUTPUT_SLACK_CHANNEL_FORMAT` | `markdown` | Format for Slack channel post |
| `OUTPUT_SLACK_CHANNEL_TONE` | `informal` | Tone for Slack channel post |
| `OUTPUT_SLACK_DM` | `false` | DM specific Slack users |
| `OUTPUT_SLACK_DM_USERS` | — | Comma-separated Slack user IDs (use `pnpm find-ids` to discover) |
| `OUTPUT_SLACK_DM_FORMAT` | `markdown` | Format for Slack DMs |
| `OUTPUT_SLACK_DM_TONE` | `informal` | Tone for Slack DMs |
| `OUTPUT_EMAIL` | `false` | Send via email (requires SMTP config below) |
| `OUTPUT_EMAIL_FORMAT` | `html` | Format for email body |
| `OUTPUT_EMAIL_TONE` | `formal` | Tone for email (formal by default — ideal for clients) |
| `OUTPUT_EMAIL_FROM` | — | Sender email address |
| `OUTPUT_EMAIL_TO` | — | Comma-separated recipient emails |
| `OUTPUT_EMAIL_SMTP_HOST` | — | SMTP server host |
| `OUTPUT_EMAIL_SMTP_PORT` | `587` | SMTP server port |
| `OUTPUT_EMAIL_SMTP_USER` | — | SMTP username |
| `OUTPUT_EMAIL_SMTP_PASS` | — | SMTP password |
| `OUTPUT_PDF` | `true` | Generate PDF (uses headless Chrome via puppeteer) |
| `OUTPUT_EMAIL_ATTACH_PDF` | `true` | Attach PDF to email when available |

**Available formats:** `markdown` (md), `html`, `json`, `txt` (plain text), `pdf`

**Available tones:** `informal` (teammate-friendly, with emojis), `formal` (client-facing, no emojis)

### Auto-discovery mode

Instead of manually listing channel IDs in `SLACK_CHANNEL_GROUPS`, you can auto-discover them by prefix:

```env
USE_SLACK_SECTIONS=true
SLACK_PROJECT_PREFIXES={"Project1": ["project1"], "Project2": ["project2"]}
```

## Usage

```bash
# Generate current weekly digest
pnpm dev

# Discover Slack channels, users, and ClickUp structure
pnpm find-ids

# Generate previous sprint report
SPRINT_OFFSET=1 pnpm dev

# Generate digest in English
REPORT_LANG=en pnpm dev

# Send formal report via email to clients
OUTPUT_EMAIL=true OUTPUT_EMAIL_TONE=formal pnpm dev

# Save both tones locally (digests/informal/ & digests/formal/)
OUTPUT_LOCAL_FILE_TONE=all pnpm dev

# Debug mode (verbose logging)
LOG_LEVEL=debug pnpm dev
```

The digest is delivered to all enabled outputs (local file, Slack channel, DM, email).

## Project Structure

```
src/
├── config/
│   ├── constants.ts        API URLs, limits, regex patterns
│   ├── env.ts              Env var parsing, validation, API clients
│   ├── i18n.ts             Report language translations (en/es)
│   ├── logger.ts           Pino logger setup
│   └── types.ts            TypeScript interfaces
├── services/
│   ├── anthropic.ts        Context building, prompt, digest generation
│   ├── clickup.ts          ClickUp API: tasks, sprint periods
│   ├── slack.ts            Slack API: messages, threads, posting
│   ├── sprint-resolver.ts  Sprint folder/list resolution
│   ├── format/             Formatting layer (md → html, json, txt, pdf)
│   │   ├── types.ts        FormattedDigest interface + helpers
│   │   ├── index.ts        Format orchestrator
│   │   ├── html.ts         Markdown → styled HTML
│   │   ├── json.ts         Markdown → structured JSON
│   │   ├── plain-text.ts   Markdown → clean plain text
│   │   └── pdf.ts          HTML → PDF (puppeteer)
│   └── output/             Delivery drivers
│       ├── types.ts        OutputDriver interface
│       ├── index.ts        Dispatcher (collects enabled drivers)
│       ├── local-file.ts   Save to digests/ folder
│       ├── slack-channel.ts Post to Slack channel
│       ├── slack-dm.ts     DM specific Slack users
│       └── email.ts        Send via email (nodemailer)
├── main.ts                 Entry point (orchestration)
└── find-ids.ts             Utility: discover Slack channels, users, ClickUp IDs
```

## Dev Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Run the digest pipeline |
| `pnpm find-ids` | Print Slack channels, users, and ClickUp structure |
| `pnpm lint` | Run ESLint |
| `pnpm lint:fix` | Run ESLint with auto-fix |
| `pnpm format` | Format code with Prettier |
| `pnpm check` | Full check: TypeScript + ESLint + Prettier |
