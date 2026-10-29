export type StatusBucket = "todo" | "in-progress" | "completed" | "deployed";

export interface MonthMeta {
  key: string; // "YYYY-MM"
  label: string; // "October 2026"
  shortLabel: string; // "Oct 2026"
  monthName: string; // "October"
  shortMonthName: string; // "Oct"
  year: number;
  month: number; // 1-12
  hasData: boolean;
  issueCount: number;
  isCurrent?: boolean;
  isPrevious?: boolean;
}

export interface MonthlyTotals {
  issueCount: number;
  committedPoints: number;
  completedPoints: number;
  remainingPoints: number;
  completionPct: number;
  doneCount: number;
  inProgressCount: number;
  todoCount: number;
  loggedHours: number;
  worklogEntryCount: number;
}

export interface MonthlyMemberPerformance {
  assigneeAccountId: string | null;
  assigneeName: string;
  committedPoints: number;
  completedPoints: number;
  totalCount: number;
  doneCount: number;
  loggedHours: number;
}

export interface MonthlyIssueItem {
  id: string;
  key: string;
  summary: string;
  status: string;
  statusCategory: string;
  bucket: StatusBucket;
  issueType: string;
  priority: string;
  assigneeAccountId: string | null;
  assigneeName: string | null;
  storyPoints: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  resolvedAt: string | null;
  loggedHours: number;
  monthRole: "current" | "previous" | "other";
  monthKey: string;
  monthShort: string;
}

export interface MonthlyMonthData {
  meta: MonthMeta;
  totals: MonthlyTotals;
  statusBuckets: Record<StatusBucket, number>;
  team: MonthlyMemberPerformance[];
  issues: MonthlyIssueItem[];
}

export interface MonthlyReportData {
  boardId: string;
  year: number;
  availableYears: number[];
  months: MonthMeta[];
  byMonth: Record<string, MonthlyMonthData>;
  meta: {
    current: MonthMeta;
    previous: MonthMeta;
  };
  current: MonthlyMonthData;
  previous: MonthlyMonthData;
  comparison: {
    completedPointsDelta: number;
    completedPointsPctDelta: number | null;
    committedPointsDelta: number;
    doneCountDelta: number;
    issueCountDelta: number;
    loggedHoursDelta: number;
  };
  allIssues: MonthlyIssueItem[];
}
