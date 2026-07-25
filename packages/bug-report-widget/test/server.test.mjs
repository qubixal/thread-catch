import assert from "node:assert/strict";
import test from "node:test";
import { createDiscordBugReportHandler } from "../dist/server.js";

test("creates an Open-tagged Discord forum post without exposing its token", async () => {
  let requestToDiscord;
  const handler = createDiscordBugReportHandler({
    token: "abc.def.ghi",
    forumChannelId: "forum-123",
    tags: { Open: "tag-open", High: "tag-high" },
    fetch: async (url, init) => {
      requestToDiscord = { url, init };
      return Response.json({ id: "thread-123" }, { status: 201 });
    }
  });

  const response = await handler(new Request("https://app.example/api/bug-report", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": "198.51.100.1" },
    body: JSON.stringify({ title: "Save button fails", description: "Clicking save does not persist the current draft.", severity: "high", selector: "#save", pageUrl: "https://app.example/editor" })
  }));

  assert.equal(response.status, 201);
  assert.equal(requestToDiscord.url, "https://discord.com/api/v10/channels/forum-123/threads");
  assert.equal(requestToDiscord.init.headers.Authorization, "Bot abc.def.ghi");
  assert.deepEqual(JSON.parse(requestToDiscord.init.body).applied_tags, ["tag-open", "tag-high"]);
  assert.match(JSON.parse(requestToDiscord.init.body).message.content, /https:\/\/app\.example\/editor/);
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
