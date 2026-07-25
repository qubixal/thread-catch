declare const severityOptions: readonly ["low", "medium", "high", "critical"];
type Severity = (typeof severityOptions)[number];
type BugReportInput = {
    title: string;
    description: string;
    severity: Severity;
    selector?: string;
    pageUrl?: string;
    userAgent?: string;
};
type DiscordTagIds = Partial<Record<"Open" | "Low" | "Medium" | "High" | "Critical", string>>;

export type { BugReportInput as B, DiscordTagIds as D, Severity as S };
