export const severityOptions = ["low", "medium", "high", "critical"] as const;

export type Severity = (typeof severityOptions)[number];

export type BugReportInput = {
  title: string;
  description: string;
  severity: Severity;
  selector?: string;
  pageUrl?: string;
  userAgent?: string;
};

export type DiscordTagIds = Partial<Record<"Open" | "Low" | "Medium" | "High" | "Critical", string>>;
