# ThreadCatch

Send web app bug reports to a Discord Forum channel.

_Discord bot token is never shown in the browser._

## Quick start

Install the package, then run the one setup command from your Next.js project:

```bash
npm install thread-catch
npx thread-catch init --token "$DISCORD_BOT_TOKEN"
```

`init` discovers the Discord server your bot belongs to, creates or reuses a `bug-reports` Forum channel, adds `Open`, `Low`, `Medium`, `High`, and `Critical` tags, writes `.env.local`, and creates `app/api/bug-report/route.ts`. No Discord IDs are copied by hand. If the bot belongs to more than one server, the CLI asks you to choose one.

Add the widget once in a Client Component:

```tsx
"use client";

import { BugReportWidget } from "thread-catch";

export function AppShell() {
  return <BugReportWidget />;
}
```

Your bot must already be installed in the target server with:
1. **Manage Channels**
2. **Create Public Threads**
3. **Send Messages**
4. **Manage Threads**

The CLI only needs the bot token; it uses Discord's Gateway to discover the server rather than asking for a guild ID.

## Options

```bash
npx thread-catch init --token "$DISCORD_BOT_TOKEN" --forum customer-bugs --route /api/report-bug
```

Use `--dir path/to/next-app` when invoked outside the Next.js project. `--guild <id>` is available for unattended multi-server installs.

The widget defaults to `POST /api/bug-report`; override it with `<BugReportWidget endpoint="/api/report-bug" />`.

## Security model

- The public package entry exports only the client widget. Discord REST code is an unexported internal module.
- The Next.js entry is `thread-catch/next`, imports `server-only`, and fails Next builds when imported from a Client Component.
- The generated route reads the bot token only from `process.env.DISCORD_BOT_TOKEN`. The widget has no token prop.
- `.env.local` is added to `.gitignore`; the CLI does not print the token.
- The server validates input, disables Discord mentions, limits report bodies, and has a conservative in-memory per-IP rate limit (5 reports per 10 minutes by default).

The in-memory limit is intentionally dependency-free. For multi-instance deployments, place a platform rate limiter in front of the generated route.

## Framework-agnostic handler

For another server framework, use the standards-based handler from the server-only export:

```ts
import { createDiscordBugReportHandler } from "thread-catch/server";

const report = createDiscordBugReportHandler({
  token: process.env.DISCORD_BOT_TOKEN!,
  forumChannelId: process.env.DISCORD_BUG_REPORT_FORUM_ID!,
  tags: process.env.DISCORD_BUG_REPORT_TAGS
});

// Adapt `report(request)` to your framework's Request/Response bridge.
```

Do not import `thread-catch/server` from browser code.
