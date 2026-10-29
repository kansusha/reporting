export type StatusBucket = "todo" | "in-progress" | "completed" | "deployed";

export interface QuarterMeta {
  key: string; // "2026-Q4"
  label: string; // "Q4 2026"
  year: number;
  quarter: number; // 1-4
  months: string[]; // ["2026-10","2026-11","2026-12"]
  hasData: boolean;
  issueCount: number;
  isCurrent?: boolean;
  isPrevious?: boolean;
}

export interface QuarterlyTotals {
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

export interface QuarterlyMemberPerformance {
  assigneeAccountId: string | null;
  assigneeName: string;
  committedPoints: number;
  completedPoints: number;
  totalCount: number;
  doneCount: number;
  loggedHours: number;
}

export interface QuarterlyIssueItem {
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
  quarterKey: string;
  monthKey: string;
  monthShort: string;
}

export interface QuarterlyQuarterData {
  meta: QuarterMeta;
  totals: QuarterlyTotals;
  statusBuckets: Record<StatusBucket, number>;
  team: QuarterlyMemberPerformance[];
  issues: QuarterlyIssueItem[];
}

export interface QuarterlyComparison {
  completedPointsDelta: number;
  completedPointsPctDelta: number | null;
  committedPointsDelta: number;
  doneCountDelta: number;
  issueCountDelta: number;
  loggedHoursDelta: number;
}

export interface QuarterlyReportData {
  boardId: string;
  year: number;
  availableYears: number[];
  quarters: QuarterMeta[];
  byQuarter: Record<string, QuarterlyQuarterData>;
  current: QuarterlyQuarterData;
  previous: QuarterlyQuarterData;
  comparison: QuarterlyComparison;
  allIssues: QuarterlyIssueItem[];
}
