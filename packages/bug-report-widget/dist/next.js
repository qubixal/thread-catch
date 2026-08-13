// src/next.ts
import "server-only";

// src/shared.ts
var severityOptions = ["low", "medium", "high", "critical"];

// src/server.ts
var reportsByIp = /* @__PURE__ */ new Map();
var MAX_BODY_BYTES = 16e3;
var MAX_SCAN_PAGES = 20;
var DEFAULT_BLOCKED_TERMS = [
  "porn",
  "pornhub",
  "xvideos",
  "xnxx",
  "hentai",
  "sex",
  "sexual",
  "sexy",
  "nude",
  "naked",
  "tits",
  "boobs",
  "boobies",
  "pussy",
  "dick",
  "cock",
  "cunt",
  "fuck",
  "fucking",
  "shit",
  "bitch",
  "slut",
  "whore",
  "rape",
  "molest",
  "gore",
  "snuff",
  "pedophile",
  "pedo",
  "zoophile"
];
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function buildBlockedPattern(extraTerms) {
  const terms = DEFAULT_BLOCKED_TERMS.concat(extraTerms.map((term) => escapeRegExp(term.trim())).filter((term) => term.length > 2));
  return new RegExp(`\\b(?:${terms.join("|")})\\b`, "i");
}
function containsExplicitContent(text, pattern) {
  return pattern.test(text);
}
var THREAD_NUMBER_PATTERNS = [
  /^\s*[#＃№]\s*(\d+)/,
  /[#＃№]\s*(\d+)\s*\)?\s*$/,
  /[#＃№]\s*(\d+)/
];
function formatThreadNumber(number) {
  return `#${String(number).padStart(4, "0")}`;
}
function threadNumberFromName(name) {
  for (const pattern of THREAD_NUMBER_PATTERNS) {
    const match = pattern.exec(name);
    if (match) return Number(match[1]);
  }
  return null;
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
var THREAD_LIST_CATEGORIES = ["active", "archived/public", "archived/private"];
async function latestThreadNumber(token, forumChannelId, fetchImpl) {
  const results = await Promise.allSettled(THREAD_LIST_CATEGORIES.map((path) => listThreadPages(token, forumChannelId, fetchImpl, path)));
  let max = 0;
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error(`thread-catch: could not list ${THREAD_LIST_CATEGORIES[index]} threads: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      return;
    }
    for (const thread of result.value) {
      const number = threadNumberFromName(thread.name);
      if (number !== null && number > max) max = number;
    }
  });
  return max;
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
  const blockedPattern = buildBlockedPattern(options.extraBlockedTerms ?? []);
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
    if (containsExplicitContent(`${title}
${description}`, blockedPattern)) return json({ error: "Report blocked by the content filter." }, 400);
    const severityName = `${input.severity[0].toUpperCase()}${input.severity.slice(1)}`;
    const appliedTags = [tagIds.Open, tagIds[severityName]].filter((tag) => Boolean(tag));
    const report = { title, description, severity: input.severity, selector, pageUrl };
    const threadNumber = Math.max(await latestThreadNumber(token, forumChannelId, fetchImpl) + 1, lastIssuedNumber + 1);
    if (threadNumber === 1) {
      console.warn("thread-catch: no numbered forum posts found; posting #0001. If posts are numbered but archived, the bot needs the Read Message History permission to detect them.");
    }
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
  createDiscordBugReportHandler as createNextBugReportHandler
};
//# sourceMappingURL=next.js.map