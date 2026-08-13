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

function post(handler, body = {}, ip = "198.51.100.1") {
  return handler(new Request("https://app.example/api/bug-report", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": ip },
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

test("blocks reports containing explicit content before contacting Discord", async () => {
  let contactedDiscord = false;
  const handler = createDiscordBugReportHandler({
    token: "abc.def.ghi",
    forumChannelId: "forum-123",
    fetch: async () => {
      contactedDiscord = true;
      return Response.json({});
    }
  });

  const response = await post(handler, { description: "Reproduced after visiting this pornhub link." }, "198.51.100.51");

  assert.equal(response.status, 400);
  assert.equal(contactedDiscord, false);
});

test("blocks extra terms supplied via extraBlockedTerms but allows benign text", async () => {
  const calls = [];
  const handler = createDiscordBugReportHandler({
    token: "abc.def.ghi",
    forumChannelId: "forum-123",
    extraBlockedTerms: ["flibbertigibbet"],
    fetch: async (url) => {
      calls.push(String(url));
      if (String(url).includes("/threads/")) return Response.json({ threads: [], has_more: false }, { status: 200 });
      return Response.json({ id: "thread-123" }, { status: 201 });
    }
  });

  const blocked = await post(handler, { description: "It happened in flibbertigibbet mode." }, "198.51.100.54");
  assert.equal(blocked.status, 400);
  assert.equal(calls.length, 0);

  const allowed = await post(handler, { description: "Clicking save in sussex does not persist the draft." }, "198.51.100.55");
  assert.equal(allowed.status, 201);
  assert.ok(calls.some((url) => !url.includes("/threads/")));
});

test("picks up numbers placed at the end of post names", async () => {
  const mock = discordMock([
    { name: "Save button fails #0011" },
    { name: "Crash report (#0007)" },
    { name: "#0042 - Old report" }
  ]);
  const handler = createDiscordBugReportHandler({ token: "abc.def.ghi", forumChannelId: "forum-123", fetch: mock.fetch });

  await post(handler, {}, "198.51.100.61");

  const created = mock.requests.find((request) => String(request.url).endsWith("/channels/forum-123/threads"));
  assert.equal(JSON.parse(created.init.body).name, "#0043 - Save button fails");
});

test("still numbers correctly when one list endpoint fails", async () => {
  const requests = [];
  const handler = createDiscordBugReportHandler({
    token: "abc.def.ghi",
    forumChannelId: "forum-123",
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      if (String(url).includes("/threads/archived/public")) return new Response("forbidden", { status: 403 });
      if (String(url).includes("/threads/")) return Response.json({ threads: [{ name: "#0012 - Manual fix" }], has_more: false }, { status: 200 });
      return Response.json({ id: "thread-123" }, { status: 201 });
    }
  });

  const response = await post(handler, {}, "198.51.100.62");

  assert.equal(response.status, 201);
  const created = requests.find((entry) => entry.url.endsWith("/channels/forum-123/threads"));
  assert.equal(JSON.parse(created.init.body).name, "#0013 - Save button fails");
});

test("posts #0001 when every list endpoint fails", async () => {
  const requests = [];
  const handler = createDiscordBugReportHandler({
    token: "abc.def.ghi",
    forumChannelId: "forum-123",
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      if (String(url).includes("/threads/")) return new Response("forbidden", { status: 403 });
      return Response.json({ id: "thread-123" }, { status: 201 });
    }
  });

  const response = await post(handler, {}, "198.51.100.63");

  assert.equal(response.status, 201);
  const created = requests.find((entry) => entry.url.endsWith("/channels/forum-123/threads"));
  assert.equal(JSON.parse(created.init.body).name, "#0001 - Save button fails");
});
