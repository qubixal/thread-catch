import "server-only";

// `server-only` makes Next.js fail the build if this entry is imported by a Client Component.
export { createDiscordBugReportHandler as createNextBugReportHandler } from "./server.js";
export type { BugReportHandlerOptions, BugReportInput, DiscordTagIds, Severity } from "./server.js";
