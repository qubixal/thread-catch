import { D as DiscordTagIds } from './shared-Dd5jsEYr.js';
export { B as BugReportInput, S as Severity } from './shared-Dd5jsEYr.js';

type BugReportHandlerOptions = {
    /** Bot token. Supply only from server-side environment variables. */
    token: string;
    forumChannelId: string;
    tags?: DiscordTagIds | string;
    /** Maximum reports per IP during the active in-memory window. Default: 5. */
    maxRequestsPerWindow?: number;
    /** Rate limit window in milliseconds. Default: 10 minutes. */
    rateLimitWindowMs?: number;
    /** Extra terms blocked by the explicit-content filter, in addition to the built-in list. */
    extraBlockedTerms?: string[];
    fetch?: typeof globalThis.fetch;
};
/**
 * Creates a standards-based request handler. It is intentionally server-only:
 * pass the bot token from a server environment variable and never from the widget.
 */
declare function createDiscordBugReportHandler(options: BugReportHandlerOptions): (request: Request) => Promise<Response>;

export { type BugReportHandlerOptions, DiscordTagIds, createDiscordBugReportHandler };
