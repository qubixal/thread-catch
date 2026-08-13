import assert from "node:assert/strict";
import test from "node:test";
import { createDiscordBugReportHandler } from "../dist/server.js";

function discordMock(seedThreads = []) {
  const requests = [];
  return {
    requests,
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      if (String(url).includes("/threads/")) {
        return Response.json({ threads: seedThreads, has_more: false }, { status: 200 });
      }
      return Response.json({ id: "thread-123" }, { status: 201 });
    }
  };
}

function post(handler, body = {}) {
  return handler(new Request("https://app.example/api/bug-report", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": "198.51.100.1" },
    body: JSON.stringify({ title: "Save button fails", description: "Clicking save does not persist the current draft.", severity: "high", selector: "#save", pageUrl: "https://app.example/editor", ...body })
  }));
}

test("creates an Open-tagged Discord forum post without exposing its token", async () => {
  const mock = discordMock();
  const handler = createDiscordBugReportHandler({
    token: "abc.def.ghi",
    forumChannelId: "forum-123",
    tags: { Open: "tag-open", High: "tag-high" },
    fetch: mock.fetch
  });

  const response = await post(handler);

  assert.equal(response.status, 201);
  const created = mock.requests.find((request) => String(request.url).endsWith("/channels/forum-123/threads"));
  assert.ok(created, "expected a thread creation request");
  assert.equal(created.init.headers.Authorization, "Bot abc.def.ghi");
  assert.deepEqual(JSON.parse(created.init.body).applied_tags, ["tag-open", "tag-high"]);
  assert.match(JSON.parse(created.init.body).message.content, /https:\/\/app\.example\/editor/);
});

test("prefixes the post title with the next number starting at #0001", async () => {
  const mock = discordMock();
  const handler = createDiscordBugReportHandler({
    token: "abc.def.ghi",
    forumChannelId: "forum-123",
    fetch: mock.fetch
  });

  const response = await post(handler);

  assert.equal(response.status, 201);
  const created = mock.requests.find((request) => String(request.url).endsWith("/channels/forum-123/threads"));
  assert.equal(JSON.parse(created.init.body).name, "#0001 - Save button fails");
});

test("numbers increase from the largest existing forum post number", async () => {
  const mock = discordMock([
    { name: "Some old report" },
    { name: "#0042 - Crash on login" },
    { name: "#0007 - Typos" }
  ]);
  const handler = createDiscordBugReportHandler({
    token: "abc.def.ghi",
    forumChannelId: "forum-123",
    fetch: mock.fetch
  });

  const response = await post(handler);

  assert.equal(response.status, 201);
  const created = mock.requests.find((request) => String(request.url).endsWith("/channels/forum-123/threads"));
  assert.equal(JSON.parse(created.init.body).name, "#0043 - Save button fails");
});

test("drops to fewer zeroes once the number passes 9999", async () => {
  const mock = discordMock([{ name: "#9999 - Almost done" }]);
  const handler = createDiscordBugReportHandler({
    token: "abc.def.ghi",
    forumChannelId: "forum-123",
    fetch: mock.fetch
  });

  const response = await post(handler);

  assert.equal(response.status, 201);
  const created = mock.requests.find((request) => String(request.url).endsWith("/channels/forum-123/threads"));
  assert.equal(JSON.parse(created.init.body).name, "#10000 - Save button fails");
});

test("scans the forum across all three thread list endpoints", async () => {
  const requests = [];
  const seed = [{ name: "#0050 - Hidden bug" }];
  const handler = createDiscordBugReportHandler({
    token: "abc.def.ghi",
    forumChannelId: "forum-123",
    fetch: async (url) => {
      requests.push(String(url));
      if (String(url).includes("/threads/")) return Response.json({ threads: seed, has_more: false }, { status: 200 });
      return Response.json({ id: "thread-123" }, { status: 201 });
    }
  });

  await post(handler);

  for (const suffix of ["threads/active", "threads/archived/public", "threads/archived/private"]) {
    assert.ok(requests.some((url) => url.includes(suffix)), `expected a request to ${suffix}`);
  }
});

test("rejects malformed reports before contacting Discord", async () => {
  let contactedDiscord = false;
  const handler = createDiscordBugReportHandler({
    token: "abc.def.ghi",
    forumChannelId: "forum-123",
    fetch: async () => {
      contactedDiscord = true;
      return Response.json({});
    }
  });
  const response = await handler(new Request("https://app.example/api/bug-report", {
    method: "POST",
    body: JSON.stringify({ title: "no", description: "too short", severity: "urgent" })
  }));

  assert.equal(response.status, 400);
  assert.equal(contactedDiscord, false);
});
