// src/shared.ts
var severityOptions = ["low", "medium", "high", "critical"];

// src/server.ts
var reportsByIp = /* @__PURE__ */ new Map();
var MAX_BODY_BYTES = 16e3;
var MAX_SCAN_PAGES = 20;
var THREAD_NUMBER_PATTERN = /^#(\d+)(?:\s+-|$|\s)/;
function formatThreadNumber(number) {
  return `#${String(number).padStart(4, "0")}`;
}
function threadNumberFromName(name) {
  const match = THREAD_NUMBER_PATTERN.exec(name);
  return match ? Number(match[1]) : null;
}
async function listThreadPages(token, forumChannelId, fetchImpl, path) {
  const threads = [];
  let before;
  for (let page = 0; page < MAX_SCAN_PAGES; page += 1) {
    const query = new URLSearchParams({ limit: "100" });
    if (before) query.set("before", before);
    const response = await fetchImpl(`https://discord.com/api/v10/channels/${encodeURIComponent(forumChannelId)}/threads/${path}?${query}`, {
      headers: { Authorization: `Bot ${token}` }
    });
    if (!response.ok) throw new Error(`Discord list threads ${response.status}`);
    const body = await response.json();
    const batch = body.threads ?? [];
    threads.push(...batch);
    if (!batch.length || !body.has_more) break;
    before = batch[batch.length - 1].archive_timestamp;
    if (!before) break;
  }
  return threads;
}
function latestThreadNumber(token, forumChannelId, fetchImpl) {
  return Promise.all([
    listThreadPages(token, forumChannelId, fetchImpl, "active"),
    listThreadPages(token, forumChannelId, fetchImpl, "archived/public"),
    listThreadPages(token, forumChannelId, fetchImpl, "archived/private")
  ]).then((lists) => {
    let max = 0;
    for (const list of lists) for (const thread of list) {
      const number = threadNumberFromName(thread.name);
      if (number !== null && number > max) max = number;
    }
    return max;
  });
}
function json(body, status) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}
function cleanText(value, min, max) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/\u0000/g, "");
  return cleaned.length >= min && cleaned.length <= max ? cleaned : null;
}
function isSeverity(value) {
  return typeof value === "string" && severityOptions.includes(value);
}
function parseTags(value) {
  if (!value) return {};
  if (typeof value !== "string") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function clientIp(request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}
function isRateLimited(ip, maxRequests, windowMs) {
  const now = Date.now();
  const current = reportsByIp.get(ip);
  if (!current || current.resetAt <= now) {
    reportsByIp.set(ip, { count: 1, resetAt: now + windowMs });
    return false;
  }
  current.count += 1;
  return current.count > maxRequests;
}
function discordContent(report) {
  const lines = [
    `**Severity:** ${report.severity.toUpperCase()}`,
    report.pageUrl ? `**Page:** ${report.pageUrl}` : "",
    report.selector ? `**Element:** \`${report.selector}\`` : "",
    "",
    report.description
  ].filter(Boolean);
  return lines.join("\n").slice(0, 1950);
}
function createDiscordBugReportHandler(options) {
  const token = options.token.trim();
  const forumChannelId = options.forumChannelId.trim();
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const tagIds = parseTags(options.tags);
  const maxRequests = options.maxRequestsPerWindow ?? 5;
  const windowMs = options.rateLimitWindowMs ?? 10 * 60 * 1e3;
  let lastIssuedNumber = 0;
  if (!token || !forumChannelId) throw new Error("DISCORD_BOT_TOKEN and DISCORD_BUG_REPORT_FORUM_ID are required on the server.");
  return async function handleBugReport(request) {
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_BODY_BYTES) return json({ error: "Report is too large." }, 413);
    if (isRateLimited(clientIp(request), maxRequests, windowMs)) return json({ error: "Too many reports. Please try again later." }, 429);
    let raw;
    try {
      const text = await request.text();
      if (text.length > MAX_BODY_BYTES) return json({ error: "Report is too large." }, 413);
      raw = JSON.parse(text);
    } catch {
      return json({ error: "Invalid report payload." }, 400);
    }
    if (!raw || typeof raw !== "object") return json({ error: "Invalid report payload." }, 400);
    const input = raw;
    const title = cleanText(input.title, 3, 120);
    const description = cleanText(input.description, 10, 4e3);
    const selector = cleanText(input.selector, 0, 512) || void 0;
    const pageUrl = cleanText(input.pageUrl, 0, 2e3) || void 0;
    if (!title || !description || !isSeverity(input.severity)) return json({ error: "Title, details, and severity are required." }, 400);
    const severityName = `${input.severity[0].toUpperCase()}${input.severity.slice(1)}`;
    const appliedTags = [tagIds.Open, tagIds[severityName]].filter((tag) => Boolean(tag));
    const report = { title, description, severity: input.severity, selector, pageUrl };
    let threadNumber = 0;
    try {
      threadNumber = await latestThreadNumber(token, forumChannelId, fetchImpl);
    } catch (error) {
      console.error("thread-catch: could not read existing forum numbers", error);
      threadNumber = 0;
    }
    threadNumber = Math.max(threadNumber + 1, lastIssuedNumber + 1);
    lastIssuedNumber = threadNumber;
    const numberedTitle = `${formatThreadNumber(threadNumber)} - ${title.replace(/^#\s*\d+\s*[-–—]?\s*/, "")}`;
    let response;
    try {
      response = await fetchImpl(`https://discord.com/api/v10/channels/${encodeURIComponent(forumChannelId)}/threads`, {
        method: "POST",
        headers: { Authorization: `Bot ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          name: numberedTitle,
          type: 11,
          auto_archive_duration: 1440,
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
export {
  createDiscordBugReportHandler
};
//# sourceMappingURL=server.js.map