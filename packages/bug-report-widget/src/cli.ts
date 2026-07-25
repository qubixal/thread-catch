#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import WebSocket from "ws";

type DiscordGuild = { id: string; name: string };
type DiscordTag = { id: string; name: string; moderated?: boolean };
type DiscordChannel = { id: string; name: string; type: number; available_tags?: DiscordTag[] };
type InitArgs = { token?: string; guild?: string; directory: string; forum: string; route: string; help?: boolean };

const api = "https://discord.com/api/v10";
const tagNames = ["Open", "Low", "Medium", "High", "Critical"] as const;

function usage() {
  return `Usage:\n  npx thread-catch init --token \"$DISCORD_BOT_TOKEN\" [options]\n\nOptions:\n  --guild <id>       Choose a guild when the bot belongs to more than one\n  --dir <path>       Next.js project directory (default: current directory)\n  --forum <name>     Forum channel name (default: bug-reports)\n  --route <path>     Route path (default: /api/bug-report)\n\nThe bot needs Manage Channels, Create Public Threads, Send Messages, and Manage Threads.`;
}

function parseArgs(argv: string[]): InitArgs {
  const values: InitArgs = { directory: process.cwd(), forum: "bug-reports", route: "/api/bug-report" };
  if (argv[0] === "--help" || argv[0] === "-h") return { ...values, help: true };
  if (argv[0] !== "init") throw new Error(usage());
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--help" || flag === "-h") return { ...values, help: true };
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    if (flag === "--token") values.token = value;
    else if (flag === "--guild") values.guild = value;
    else if (flag === "--dir") values.directory = resolve(value);
    else if (flag === "--forum") values.forum = value;
    else if (flag === "--route") values.route = value;
    else throw new Error(`Unknown option: ${flag}`);
    index += 1;
  }
  return values;
}

function validToken(token: string | undefined) {
  return Boolean(token && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token));
}

async function rest<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${api}${path}`, {
    ...init,
    headers: { Authorization: `Bot ${token}`, "content-type": "application/json", ...init.headers }
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Discord API ${response.status}: ${body.slice(0, 220)}`);
  }
  return response.json() as Promise<T>;
}

async function discoverGuilds(token: string): Promise<DiscordGuild[]> {
  const gateway = await rest<{ url: string }>(token, "/gateway/bot");
  return new Promise((resolveGuilds, reject) => {
    const socket = new WebSocket(`${gateway.url}?v=10&encoding=json`);
    const guilds = new Map<string, DiscordGuild>();
    let ready = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let finish: ReturnType<typeof setTimeout> | undefined;
    const close = () => {
      if (heartbeat) clearInterval(heartbeat);
      if (finish) clearTimeout(finish);
      socket.close();
    };
    const complete = () => {
      close();
      resolveGuilds([...guilds.values()]);
    };
    socket.once("error", (error) => {
      close();
      reject(new Error(`Could not connect to Discord Gateway: ${error.message}`));
    });
    socket.on("message", (data) => {
      const packet = JSON.parse(data.toString()) as { op: number; d?: any; t?: string };
      if (packet.op === 10) {
        heartbeat = setInterval(() => socket.send(JSON.stringify({ op: 1, d: Date.now() })), packet.d.heartbeat_interval);
        socket.send(JSON.stringify({ op: 2, d: { token, intents: 1, properties: { os: process.platform, browser: "thread-catch", device: "thread-catch" } } }));
      }
      if (packet.t === "READY") {
        ready = true;
        for (const guild of packet.d.guilds as DiscordGuild[]) guilds.set(guild.id, guild);
        finish = setTimeout(complete, 700);
      }
      if (packet.t === "GUILD_CREATE") guilds.set(packet.d.id, { id: packet.d.id, name: packet.d.name });
      if (ready && packet.t === "GUILD_CREATE" && finish) {
        clearTimeout(finish);
        finish = setTimeout(complete, 300);
      }
    });
    setTimeout(() => {
      if (!ready) {
        close();
        reject(new Error("Discord Gateway did not return the bot's guilds. Confirm that the token is valid and the bot is installed in a server."));
      }
    }, 12_000);
  });
}

async function chooseGuild(guilds: DiscordGuild[], requested: string | undefined) {
  if (requested) {
    const guild = guilds.find((item) => item.id === requested);
    if (!guild) throw new Error("The supplied --guild ID is not available to this bot.");
    return guild;
  }
  if (guilds.length === 1) return guilds[0];
  if (guilds.length === 0) throw new Error("This bot is not installed in any Discord server. Invite it, then run init again.");
  const terminal = createInterface({ input, output });
  try {
    output.write("\nSelect a Discord server:\n");
    guilds.forEach((guild, index) => output.write(`  ${index + 1}. ${guild.name} (${guild.id})\n`));
    const answer = await terminal.question("> ");
    const index = Number(answer) - 1;
    if (!Number.isInteger(index) || !guilds[index]) throw new Error("Choose one of the listed servers.");
    return guilds[index];
  } finally {
    terminal.close();
  }
}

async function ensureForum(token: string, guildId: string, name: string) {
  const channels = await rest<DiscordChannel[]>(token, `/guilds/${guildId}/channels`);
  let forum = channels.find((channel) => channel.type === 15 && channel.name === name);
  if (!forum) {
    forum = await rest<DiscordChannel>(token, `/guilds/${guildId}/channels`, {
      method: "POST",
      body: JSON.stringify({ name, type: 15, topic: "Bug reports submitted from the app", available_tags: tagNames.map((tag) => ({ name: tag })) })
    });
  } else {
    const tags = forum.available_tags ?? [];
    const missing = tagNames.filter((name) => !tags.some((tag) => tag.name.toLowerCase() === name.toLowerCase()));
    if (missing.length) {
      forum = await rest<DiscordChannel>(token, `/channels/${forum.id}`, {
        method: "PATCH",
        body: JSON.stringify({ available_tags: [...tags, ...missing.map((tag) => ({ name: tag }))] })
      });
    }
  }
  const tags = Object.fromEntries((forum.available_tags ?? []).map((tag) => [tag.name, tag.id]));
  if (!tags.Open) throw new Error("Discord created the forum without an Open tag. Run init again.");
  return { id: forum.id, tags };
}

function envLine(name: string, value: string) {
  return `${name}=${JSON.stringify(value)}`;
}

function setEnvValue(source: string, name: string, value: string) {
  const line = envLine(name, value);
  const matcher = new RegExp(`^${name.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}=.*$`, "m");
  return matcher.test(source) ? source.replace(matcher, line) : `${source}${source.endsWith("\n") || !source ? "" : "\n"}${line}\n`;
}

async function readOptional(path: string) {
  try { return await readFile(path, "utf8"); } catch { return ""; }
}

function routeSource() {
  return `import { createNextBugReportHandler } from "thread-catch/next";\n\nexport const runtime = "nodejs";\n\nexport const POST = createNextBugReportHandler({\n  token: process.env.DISCORD_BOT_TOKEN!,\n  forumChannelId: process.env.DISCORD_BUG_REPORT_FORUM_ID!,\n  tags: process.env.DISCORD_BUG_REPORT_TAGS\n});\n`;
}

async function scaffoldProject(directory: string, route: string, token: string, forumId: string, tags: Record<string, string>) {
  const hasSrcApp = await readOptional(join(directory, "src", "app", "layout.tsx"));
  const appRoot = hasSrcApp ? join(directory, "src", "app") : join(directory, "app");
  const segments = route.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  if (!segments.length) throw new Error("--route must not be the site root.");
  const routeFile = join(appRoot, ...segments, "route.ts");
  const currentRoute = await readOptional(routeFile);
  if (!currentRoute) {
    await mkdir(dirname(routeFile), { recursive: true });
    await writeFile(routeFile, routeSource(), "utf8");
  }
  const envPath = join(directory, ".env.local");
  let env = await readOptional(envPath);
  env = setEnvValue(env, "DISCORD_BOT_TOKEN", token);
  env = setEnvValue(env, "DISCORD_BUG_REPORT_FORUM_ID", forumId);
  env = setEnvValue(env, "DISCORD_BUG_REPORT_TAGS", JSON.stringify(tags));
  await writeFile(envPath, env, "utf8");
  const gitignorePath = join(directory, ".gitignore");
  const gitignore = await readOptional(gitignorePath);
  if (!gitignore.split(/\r?\n/).includes(".env.local")) await writeFile(gitignorePath, `${gitignore}${gitignore.endsWith("\n") || !gitignore ? "" : "\n"}.env.local\n`, "utf8");
  return routeFile;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return output.write(`${usage()}\n`);
  const token = args.token;
  if (!token || !validToken(token)) throw new Error("Pass a valid Discord bot token with --token. The token is saved only to .env.local.");
  if (!args.route.startsWith("/")) throw new Error("--route must start with /.");
  output.write("Connecting to Discord...\n");
  const guild = await chooseGuild(await discoverGuilds(token), args.guild);
  output.write(`Provisioning #${args.forum} in ${guild.name}...\n`);
  const forum = await ensureForum(token, guild.id, args.forum);
  const routeFile = await scaffoldProject(args.directory, args.route, token, forum.id, forum.tags);
  output.write(`\nDone. Created or reused #${args.forum}, wrote .env.local, and scaffolded ${routeFile}.\nAdd <BugReportWidget /> to a Client Component, then start Next.js.\n`);
}

main().catch((error) => {
  output.write(`\nthread-catch: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
