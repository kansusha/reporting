export type StatusBucket = "todo" | "in-progress" | "completed" | "deployed";

export type ReportView =
  | "overview"
  | "tickets"
  | "team"
  | "work-log"
  | "points"
  | "carry-forward"
  | "monthly";

export interface SprintReport {
  sprint: {
    id: string;
    boardId: string;
    boardName: string;
    name: string;
    state: string;
    goal: string;
    startDate: string | null;
    endDate: string | null;
    completeDate: string | null;
    syncedAt: string;
  };
  totals: {
    issueCount: number;
    committedPoints: number;
    completedPoints: number;
    remainingPoints: number;
    completionPct: number;
    todoCount: number;
    inProgressCount: number;
    doneCount: number;
    carryForwardCount: number;
    loggedHours: number;
    worklogEntryCount: number;
  };
  statusBreakdown: { status: string; statusCategory: string; count: number }[];
  statusBuckets?: Record<StatusBucket, number>;
  team: {
    assigneeAccountId: string | null;
    assigneeName: string;
    committedPoints: number;
    completedPoints: number;
    totalCount: number;
    doneCount: number;
    loggedHours: number;
  }[];
  carryForward: {
    key: string;
    summary: string;
    status: string;
    assigneeName: string;
    storyPoints: number | null;
    loggedHours: number;
  }[];
  workLog: {
    window: { from: string; to: string; timeZone: string } | null;
    byMember: { accountId: string; name: string; loggedHours: number; entryCount: number }[];
    byIssue: {
      key: string;
      summary: string;
      assigneeName: string;
      inSprint: boolean;
      loggedHours: number;
    }[];
    entries: {
      id: string;
      issueKey: string;
      summary: string;
      inSprint: boolean;
      authorName: string;
      hours: number;
      started: string;
    }[];
  };
}

export interface MemberExclusion {
  members: { accountId: string; name: string }[];
  onExclude: (accountId: string) => void;
  onRestore: (accountId: string) => void;
  pending: boolean;
}

export interface SprintIssueItem {
  id: string;
  key: string;
  summary: string;
  status: string;
  statusCategory: string;
  bucket: StatusBucket;
  issueType?: string;
  priority?: string;
  assigneeAccountId?: string | null;
  assigneeName?: string | null;
  storyPoints?: number | null;
  loggedHours: number;
}

export function formatHours(hours: number): string {
  return `${hours} h`;
}

export function statusIndicatorClass(category: string): string {
  if (category === "done") return "state-done";
  if (category === "indeterminate") return "state-progress";
  return "state-todo";
}

export function bucketBadgeClass(bucket: StatusBucket): string {
  switch (bucket) {
    case "deployed":
      return "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
    case "completed":
      return "border-primary/25 bg-primary/10 text-primary";
    case "in-progress":
      return "border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400";
    case "todo":
      return "border-border bg-muted/60 text-muted-foreground";
  }
}

export function bucketLabel(bucket: StatusBucket): string {
  switch (bucket) {
    case "deployed":
      return "Deployed";
    case "completed":
      return "Completed";
    case "in-progress":
      return "In Progress";
    case "todo":
      return "To Do";
  }
}
