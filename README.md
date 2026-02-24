# Zerf Weekly Digest

Automated sprint/weekly report generator for **Zerf**. Pulls closed tasks from ClickUp and messages from Slack, feeds them to Anthropic (Claude), and delivers the digest to configured outputs — Slack channels, DMs, email, or local files — in multiple formats and tones.

Architecture: **React frontend → Fastify REST API → PostgreSQL**. Digests are configured through the web dashboard and stored in the database. No `.env` changes needed to add a new digest or change an output.

---

## Setup

1. **Enable corepack** (if not already):
   ```bash
   corepack enable
   ```

2. **Start a PostgreSQL database.** Using Docker:
   ```bash
   docker compose up -d db
   ```
   Or use an external provider.

3. **Create a `.env` file** at the repo root (see Environment Variables below).

4. **Create the tables:**
   ```bash
   psql $DATABASE_URL -f apps/api/prisma/init.sql
   ```

5. **Install dependencies and generate the Prisma client:**
   ```bash
   pnpm install && pnpm db:generate
   ```

6. **Start the API:**
   ```bash
   pnpm dev
   ```

---

## Environment Variables

These are server-level secrets — global for the whole platform. Digest-specific config (which ClickUp spaces, which Slack channels, outputs, schedule, etc.) lives in the database and is managed through the dashboard.

### Required

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (`postgresql://user:pass@host:5432/db`) |
| `ANTHROPIC_API_KEY` | Anthropic API key (`sk-ant-...`) |
| `SLACK_BOT_TOKEN` | Slack Bot OAuth token (`xoxb-...`) |
| `CLICKUP_API_TOKEN` | ClickUp personal API token |

### Optional

| Variable | Default | Description |
|---|---|---|
| `API_PORT` | `3001` | Port the API listens on |
| `API_HOST` | `0.0.0.0` | Host the API binds to |
| `NODE_ENV` | `development` | `development` or `production` |
| `LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warn`, `error`, `fatal` |

### SMTP (only required if using the email output driver)

| Variable | Default | Description |
|---|---|---|
| `SMTP_HOST` | — | SMTP server hostname |
| `SMTP_PORT` | `587` | SMTP server port |
| `SMTP_USER` | — | SMTP username |
| `SMTP_PASS` | — | SMTP password |

---

## Slack Bot Scopes

`channels:read` · `channels:history` · `groups:read` · `groups:history` · `chat:write` · `users:read` · `im:write`

---

## API

The API is registered at `http://localhost:3001`.

### Health

```
GET /health
```

### Digests

```
GET    /api/digests          List all digests
POST   /api/digests          Create a digest
GET    /api/digests/:id      Get a digest
PUT    /api/digests/:id      Update a digest
DELETE /api/digests/:id      Delete a digest
POST   /api/digests/:id/run      Trigger a run (async — returns runId immediately)
POST   /api/digests/:id/preview  Generate content without delivering to outputs
```

---

## Output Drivers

Each digest can have multiple output destinations. Configured per-digest in the database.

| Driver | Description |
|---|---|
| `slack_channel` | Post to a Slack channel |
| `slack_dm` | DM specific Slack users |
| `email` | Send via SMTP (requires SMTP env vars) |
| `local_file` | Save to `digests/` folder |

**Formats:** `markdown`, `html`, `json`, `plainText`, `pdf`

**Tones:** `informal` (teammate-friendly, with emojis), `formal` (client-facing, no emojis)

---

## Dev Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start the API in watch mode |
| `pnpm build` | Compile TypeScript to `dist/` |
| `pnpm start` | Run compiled output (production) |
| `pnpm find-ids` | Print Slack channels, users, and ClickUp structure |
| `pnpm db:migrate` | Run pending Prisma migrations |
| `pnpm db:generate` | Regenerate the Prisma client |
| `pnpm db:push` | Push schema changes without a migration (dev only) |
| `pnpm db:studio` | Open Prisma Studio |
| `pnpm lint` | Run ESLint |
| `pnpm lint:fix` | Run ESLint with auto-fix |
| `pnpm format` | Format code with Prettier |
| `pnpm check` | Full check: TypeScript + ESLint + Prettier |

---

## Project Structure

```
weekly-digest/
├── apps/
│   └── api/
│       ├── prisma/
│       │   └── schema.prisma       Database schema
│       └── src/
│           ├── core/               Digest engine (internal)
│           │   ├── config/         Constants, types, i18n, logger, Zod schemas
│           │   ├── services/       ClickUp, Slack, Anthropic, format, output drivers
│           │   ├── core.ts         runDigest(config, secrets) — engine entry point
│           │   ├── find-ids.ts     Dev utility: discover Slack/ClickUp IDs
│           │   └── index.ts        Barrel — what route handlers import
│           ├── routes/
│           │   └── digests.ts      REST routes + DB → engine config mapping
│           ├── plugins/
│           │   └── prisma.ts       Fastify plugin: exposes prisma on server instance
│           ├── db.ts               Prisma client singleton
│           ├── env.ts              Env var validation (Zod) — fails fast at startup
│           └── server.ts           Fastify server setup + boot
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

---

## Performance

- **Parallel data fetching** — ClickUp spaces, task lists, Slack projects, and channels are all fetched concurrently with `Promise.all`.
- **Prompt caching** — System message and context block are marked with `cache_control: ephemeral`. When generating 2 tones, the 2nd call reuses cached input tokens (~90% cheaper).
- **Smart tone rewriting** — The 2nd tone is rewritten from the 1st output using the small model (Haiku), not regenerated from full context. Input tokens drop ~80%.
- **Context compression** — Raw data is cleaned before sending to Claude: URLs stripped, long messages truncated, near-duplicates removed, redundant task descriptions collapsed.
- **Dynamic model selection** — When total items (tasks + messages) are below the per-digest threshold, the smaller model is used automatically.
- **Token usage logging** — Every Anthropic call logs input, output, cache-write, and cache-read token counts.
