import { severityOptions, type BugReportInput, type DiscordTagIds, type Severity } from "./shared.js";

export type BugReportHandlerOptions = {
  /** Bot token. Supply only from server-side environment variables. */
  token: string;
  forumChannelId: string;
  tags?: DiscordTagIds | string;
  /** Maximum reports per IP during the active in-memory window. Default: 5. */
  maxRequestsPerWindow?: number;
  /** Rate limit window in milliseconds. Default: 10 minutes. */
  rateLimitWindowMs?: number;
  fetch?: typeof globalThis.fetch;
};

type RateLimitEntry = { count: number; resetAt: number };

const reportsByIp = new Map<string, RateLimitEntry>();
const MAX_BODY_BYTES = 16_000;

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function cleanText(value: unknown, min: number, max: number) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/\u0000/g, "");
  return cleaned.length >= min && cleaned.length <= max ? cleaned : null;
}

function isSeverity(value: unknown): value is Severity {
  return typeof value === "string" && (severityOptions as readonly string[]).includes(value);
}

function parseTags(value: DiscordTagIds | string | undefined): DiscordTagIds {
  if (!value) return {};
  if (typeof value !== "string") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as DiscordTagIds : {};
  } catch {
    return {};
  }
}

function clientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

function isRateLimited(ip: string, maxRequests: number, windowMs: number) {
  const now = Date.now();
  const current = reportsByIp.get(ip);
  if (!current || current.resetAt <= now) {
    reportsByIp.set(ip, { count: 1, resetAt: now + windowMs });
    return false;
  }
  current.count += 1;
  return current.count > maxRequests;
}

function discordContent(report: BugReportInput) {
  const lines = [
    `**Severity:** ${report.severity.toUpperCase()}`,
    report.pageUrl ? `**Page:** ${report.pageUrl}` : "",
    report.selector ? `**Element:** \`${report.selector}\`` : "",
    "",
    report.description
  ].filter(Boolean);
  return lines.join("\n").slice(0, 1_950);
}

/**
 * Creates a standards-based request handler. It is intentionally server-only:
 * pass the bot token from a server environment variable and never from the widget.
 */
export function createDiscordBugReportHandler(options: BugReportHandlerOptions) {
  const token = options.token.trim();
  const forumChannelId = options.forumChannelId.trim();
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const tagIds = parseTags(options.tags);
  const maxRequests = options.maxRequestsPerWindow ?? 5;
  const windowMs = options.rateLimitWindowMs ?? 10 * 60 * 1_000;

  if (!token || !forumChannelId) throw new Error("DISCORD_BOT_TOKEN and DISCORD_BUG_REPORT_FORUM_ID are required on the server.");

  return async function handleBugReport(request: Request): Promise<Response> {
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_BODY_BYTES) return json({ error: "Report is too large." }, 413);
    if (isRateLimited(clientIp(request), maxRequests, windowMs)) return json({ error: "Too many reports. Please try again later." }, 429);

    let raw: unknown;
    try {
      const text = await request.text();
      if (text.length > MAX_BODY_BYTES) return json({ error: "Report is too large." }, 413);
      raw = JSON.parse(text);
    } catch {
      return json({ error: "Invalid report payload." }, 400);
    }
    if (!raw || typeof raw !== "object") return json({ error: "Invalid report payload." }, 400);

    const input = raw as Record<string, unknown>;
    const title = cleanText(input.title, 3, 120);
    const description = cleanText(input.description, 10, 4_000);
    const selector = cleanText(input.selector, 0, 512) || undefined;
    const pageUrl = cleanText(input.pageUrl, 0, 2_000) || undefined;
    if (!title || !description || !isSeverity(input.severity)) return json({ error: "Title, details, and severity are required." }, 400);

    const severityName = `${input.severity[0].toUpperCase()}${input.severity.slice(1)}` as keyof DiscordTagIds;
    const appliedTags = [tagIds.Open, tagIds[severityName]].filter((tag): tag is string => Boolean(tag));
    const report: BugReportInput = { title, description, severity: input.severity, selector, pageUrl };

    let response: Response;
    try {
      response = await fetchImpl(`https://discord.com/api/v10/channels/${encodeURIComponent(forumChannelId)}/threads`, {
        method: "POST",
        headers: { Authorization: `Bot ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          name: title,
          type: 11,
          auto_archive_duration: 1_440,
          applied_tags: appliedTags,
          message: { content: discordContent(report), allowed_mentions: { parse: [] } }
        })
      });
    } catch {
      return json({ error: "Could not reach Discord." }, 502);
    }
    if (!response.ok) {
      console.error("thread-catch: Discord rejected a report", response.status);
      return json({ error: "Could not send the report." }, 502);
    }
    return json({ ok: true }, 201);
  };
}

export type { BugReportInput, DiscordTagIds, Severity } from "./shared.js";
