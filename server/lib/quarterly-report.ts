import { eq, inArray } from "drizzle-orm";

import { getDb, schema } from "../db.js";
import { getExcludedAccountIds } from "./excluded-members.js";
import {
  isReportableIssue,
  reportableWorklogs,
  statusBucket,
  toHours,
  type StatusBucket,
} from "./sprint-report.js";
import {
  getIssueMonthKey,
  getYearMonth,
  SHORT_MONTH_NAMES,
} from "./monthly-report.js";

type Issue = typeof schema.jiraIssues.$inferSelect;
type Worklog = typeof schema.jiraWorklogs.$inferSelect;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// Q1=1, Q2=2, Q3=3, Q4=4
function monthToQuarter(month: number): number {
  return Math.ceil(month / 3);
}

function quarterMonthKeys(year: number, quarter: number): string[] {
  const start = (quarter - 1) * 3 + 1;
  return [start, start + 1, start + 2].map(
    (m) => `${year}-${String(m).padStart(2, "0")}`,
  );
}

export function makeQuarterKey(year: number, quarter: number): string {
  return `${year}-Q${quarter}`;
}

// ---------------------------------------------------------------------------
// Types (mirrored in app/lib/quarterly-report-types.ts for client use)
// ---------------------------------------------------------------------------

export interface QuarterMeta {
  key: string;
  label: string;
  year: number;
  quarter: number;
  months: string[];
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildQuarterMeta(
  year: number,
  quarter: number,
  issueCount: number,
): QuarterMeta {
  return {
    key: makeQuarterKey(year, quarter),
    label: `Q${quarter} ${year}`,
    year,
    quarter,
    months: quarterMonthKeys(year, quarter),
    hasData: issueCount > 0,
    issueCount,
  };
}

function buildQuarterData(
  meta: QuarterMeta,
  quarterIssues: QuarterlyIssueItem[],
  allWorklogs: Worklog[],
): QuarterlyQuarterData {
  const quarterWorklogs = allWorklogs.filter((w) => {
    const m = getYearMonth(w.started);
    return m != null && meta.months.includes(m);
  });

  const pts = (i: QuarterlyIssueItem) => i.storyPoints ?? 0;
  const committedPoints = round1(quarterIssues.reduce((s, i) => s + pts(i), 0));
  const doneIssues = quarterIssues.filter((i) => i.statusCategory === "done");
  const completedPoints = round1(doneIssues.reduce((s, i) => s + pts(i), 0));
  const remainingPoints = round1(committedPoints - completedPoints);
  const completionPct =
    committedPoints > 0 ? round1((completedPoints / committedPoints) * 100) : 0;

  const todoCount = quarterIssues.filter((i) => i.statusCategory === "new").length;
  const inProgressCount = quarterIssues.filter(
    (i) => i.statusCategory === "indeterminate",
  ).length;
  const doneCount = doneIssues.length;

  const statusBuckets: Record<StatusBucket, number> = {
    todo: 0,
    "in-progress": 0,
    completed: 0,
    deployed: 0,
  };
  for (const i of quarterIssues) statusBuckets[i.bucket] += 1;

  const teamMap = new Map<string, QuarterlyMemberPerformance>();
  for (const issue of quarterIssues) {
    const key = issue.assigneeAccountId ?? "unassigned";
    const row: QuarterlyMemberPerformance = teamMap.get(key) ?? {
      assigneeAccountId: issue.assigneeAccountId,
      assigneeName: issue.assigneeName ?? "Unassigned",
      committedPoints: 0,
      completedPoints: 0,
      totalCount: 0,
      doneCount: 0,
      loggedHours: 0,
    };
    row.committedPoints += pts(issue);
    row.totalCount += 1;
    if (issue.statusCategory === "done") {
      row.completedPoints += pts(issue);
      row.doneCount += 1;
    }
    teamMap.set(key, row);
  }

  const loggedByAuthor = new Map<string, { name: string; seconds: number }>();
  for (const w of quarterWorklogs) {
    const key = w.authorAccountId ?? "unassigned";
    const existing = loggedByAuthor.get(key) ?? {
      name: w.authorName ?? "Unknown",
      seconds: 0,
    };
    existing.seconds += w.timeSpentSeconds;
    loggedByAuthor.set(key, existing);
  }
  for (const [accountId, val] of loggedByAuthor) {
    const row: QuarterlyMemberPerformance = teamMap.get(accountId) ?? {
      assigneeAccountId: accountId,
      assigneeName: val.name,
      committedPoints: 0,
      completedPoints: 0,
      totalCount: 0,
      doneCount: 0,
      loggedHours: 0,
    };
    row.loggedHours = toHours(val.seconds);
    teamMap.set(accountId, row);
  }

  const team = [...teamMap.values()]
    .map((r) => ({
      ...r,
      committedPoints: round1(r.committedPoints),
      completedPoints: round1(r.completedPoints),
    }))
    .sort(
      (a, b) =>
        b.completedPoints - a.completedPoints ||
        b.committedPoints - a.committedPoints,
    );

  const loggedSeconds = quarterWorklogs.reduce((s, w) => s + w.timeSpentSeconds, 0);

  return {
    meta,
    totals: {
      issueCount: quarterIssues.length,
      committedPoints,
      completedPoints,
      remainingPoints,
      completionPct,
      doneCount,
      inProgressCount,
      todoCount,
      loggedHours: toHours(loggedSeconds),
      worklogEntryCount: quarterWorklogs.length,
    },
    statusBuckets,
    team,
    issues: quarterIssues.sort((a, b) => {
      const da = a.resolvedAt ?? a.updatedAt ?? a.createdAt ?? "";
      const db = b.resolvedAt ?? b.updatedAt ?? b.createdAt ?? "";
      return db.localeCompare(da);
    }),
  };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function computeQuarterlyReport(
  boardId: string,
): Promise<QuarterlyReportData> {
  const db = getDb();
  const sprints = await db
    .select()
    .from(schema.jiraSprints)
    .where(eq(schema.jiraSprints.boardId, boardId));

  if (sprints.length === 0) throw new Error("No sprints found for board");

  const sprintIds = sprints.map((s) => s.id);
  const [rawIssues, rawWorklogs, excludedAccountIds] = await Promise.all([
    db.select().from(schema.jiraIssues).where(inArray(schema.jiraIssues.sprintId, sprintIds)),
    db.select().from(schema.jiraWorklogs).where(inArray(schema.jiraWorklogs.sprintId, sprintIds)),
    getExcludedAccountIds(),
  ]);

  const reportableIssues = rawIssues.filter((i) => isReportableIssue(i, excludedAccountIds));
  const worklogs = reportableWorklogs(rawWorklogs, excludedAccountIds);

  // Deduplicate: keep most recently updated row per issue key
  const dedupedMap = new Map<string, Issue>();
  for (const issue of reportableIssues) {
    const existing = dedupedMap.get(issue.key);
    if (!existing) {
      dedupedMap.set(issue.key, issue);
    } else {
      const et = Date.parse(existing.resolvedAt ?? existing.updatedAt ?? existing.createdAt ?? "");
      const it = Date.parse(issue.resolvedAt ?? issue.updatedAt ?? issue.createdAt ?? "");
      if (it > et) dedupedMap.set(issue.key, issue);
    }
  }
  const uniqueIssues = [...dedupedMap.values()];

  // Collect years present in data
  const yearsSet = new Set<number>();
  for (const issue of uniqueIssues) {
    const ym = getIssueMonthKey(issue);
    if (ym) yearsSet.add(parseInt(ym.slice(0, 4), 10));
  }
  const now = new Date();
  const currentYear = now.getFullYear();
  yearsSet.add(currentYear);

  const availableYears = Array.from(yearsSet).sort((a, b) => b - a);
  const targetYear = availableYears[0]!;

  // Current and previous quarter
  const currentQuarterNum = monthToQuarter(now.getMonth() + 1);
  const currentKey = makeQuarterKey(currentYear, currentQuarterNum);
  const prevQuarterNum = currentQuarterNum === 1 ? 4 : currentQuarterNum - 1;
  const prevYear = currentQuarterNum === 1 ? currentYear - 1 : currentYear;
  const prevKey = makeQuarterKey(prevYear, prevQuarterNum);

  // Per-issue logged hours
  const issueSecondsByKey = new Map<string, number>();
  for (const w of worklogs) {
    issueSecondsByKey.set(w.issueKey, (issueSecondsByKey.get(w.issueKey) ?? 0) + w.timeSpentSeconds);
  }

  // Build annotated issue list
  const allIssuesWithMeta: QuarterlyIssueItem[] = [];
  for (const issue of uniqueIssues) {
    const monthKey = getIssueMonthKey(issue) ?? `${targetYear}-01`;
    const mNum = parseInt(monthKey.slice(5, 7), 10);
    const issueYear = parseInt(monthKey.slice(0, 4), 10);
    const monthShort = SHORT_MONTH_NAMES[mNum - 1] ?? "Unknown";
    const quarterKey = makeQuarterKey(issueYear, monthToQuarter(mNum));

    allIssuesWithMeta.push({
      id: issue.id,
      key: issue.key,
      summary: issue.summary,
      status: issue.status,
      statusCategory: issue.statusCategory,
      bucket: statusBucket(issue),
      issueType: issue.issueType,
      priority: issue.priority,
      assigneeAccountId: issue.assigneeAccountId,
      assigneeName: issue.assigneeName,
      storyPoints: issue.storyPoints,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      resolvedAt: issue.resolvedAt,
      loggedHours: toHours(issueSecondsByKey.get(issue.key) ?? 0),
      quarterKey,
      monthKey,
      monthShort,
    });
  }

  // Build a list of all quarters to generate (all years × 4 quarters + current + prev)
  const quarterSet = new Set<string>();
  for (const year of availableYears) {
    for (let q = 1; q <= 4; q++) quarterSet.add(makeQuarterKey(year, q));
  }
  quarterSet.add(currentKey);
  quarterSet.add(prevKey);

  const byQuarter: Record<string, QuarterlyQuarterData> = {};
  const quarters: QuarterMeta[] = [];

  const sortedKeys = [...quarterSet].sort((a, b) => b.localeCompare(a)); // newest first
  for (const qKey of sortedKeys) {
    const year = parseInt(qKey.slice(0, 4), 10);
    const quarter = parseInt(qKey.slice(6), 10);
    const qIssues = allIssuesWithMeta.filter((i) => i.quarterKey === qKey);
    const meta = buildQuarterMeta(year, quarter, qIssues.length);
    meta.isCurrent = qKey === currentKey;
    meta.isPrevious = qKey === prevKey;
    const data = buildQuarterData(meta, qIssues, worklogs);
    byQuarter[qKey] = data;
    quarters.push(meta);
  }

  const emptyQ = (year: number, q: number): QuarterlyQuarterData =>
    buildQuarterData(buildQuarterMeta(year, q, 0), [], []);

  const current = byQuarter[currentKey] ?? emptyQ(currentYear, currentQuarterNum);
  const previous = byQuarter[prevKey] ?? emptyQ(prevYear, prevQuarterNum);

  const cp = current.totals.completedPoints;
  const pp = previous.totals.completedPoints;

  return {
    boardId,
    year: targetYear,
    availableYears,
    quarters,
    byQuarter,
    current,
    previous,
    comparison: {
      completedPointsDelta: round1(cp - pp),
      completedPointsPctDelta: pp > 0 ? round1(((cp - pp) / pp) * 100) : null,
      committedPointsDelta: round1(
        current.totals.committedPoints - previous.totals.committedPoints,
      ),
      doneCountDelta: current.totals.doneCount - previous.totals.doneCount,
      issueCountDelta: current.totals.issueCount - previous.totals.issueCount,
      loggedHoursDelta: round1(
        current.totals.loggedHours - previous.totals.loggedHours,
      ),
    },
    allIssues: allIssuesWithMeta,
  };
}
