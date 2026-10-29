import { eq, inArray } from "drizzle-orm";

import { getDb, schema } from "../db.js";
import { getExcludedAccountIds } from "./excluded-members.js";
import {
  isReportableIssue,
  reportableWorklogs,
  STATUS_BUCKETS,
  statusBucket,
  toHours,
  type StatusBucket,
} from "./sprint-report.js";

type Sprint = typeof schema.jiraSprints.$inferSelect;
type Issue = typeof schema.jiraIssues.$inferSelect;
type Worklog = typeof schema.jiraWorklogs.$inferSelect;

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const SHORT_MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

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

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function getYearMonth(dateStr?: string | null): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function formatMonthMeta(
  year: number,
  monthZeroIndexed: number,
  issueCount: number = 0,
): MonthMeta {
  const key = `${year}-${String(monthZeroIndexed + 1).padStart(2, "0")}`;
  const monthName = MONTH_NAMES[monthZeroIndexed] ?? `Month ${monthZeroIndexed + 1}`;
  const shortMonthName = SHORT_MONTH_NAMES[monthZeroIndexed] ?? `M${monthZeroIndexed + 1}`;
  return {
    key,
    label: `${monthName} ${year}`,
    shortLabel: `${shortMonthName} ${year}`,
    monthName,
    shortMonthName,
    year,
    month: monthZeroIndexed + 1,
    hasData: issueCount > 0,
    issueCount,
  };
}

export function resolveTargetMonths(issues: Issue[], sprints: Sprint[]): {
  current: MonthMeta;
  previous: MonthMeta;
} {
  const now = new Date();
  const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevKey = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;

  // Check if any issue or sprint matches today's calendar current or previous month
  const matchesCalendar = issues.some((i) => {
    const dates = [i.resolvedAt, i.createdAt, i.updatedAt];
    return dates.some((d) => {
      const ym = getYearMonth(d);
      return ym === currentKey || ym === prevKey;
    });
  }) || sprints.some((s) => {
    const dates = [s.startDate, s.endDate, s.completeDate];
    return dates.some((d) => {
      const ym = getYearMonth(d);
      return ym === currentKey || ym === prevKey;
    });
  });

  if (matchesCalendar) {
    return {
      current: formatMonthMeta(now.getFullYear(), now.getMonth()),
      previous: formatMonthMeta(prevDate.getFullYear(), prevDate.getMonth()),
    };
  }

  // Fallback for boards with historical data (e.g. 2024 test data):
  // pick the latest date among sprints and issues
  const allDates = [
    ...sprints.map((s) => s.completeDate ?? s.endDate ?? s.startDate),
    ...issues.map((i) => i.resolvedAt ?? i.updatedAt ?? i.createdAt),
  ]
    .filter(Boolean)
    .sort()
    .reverse();

  let result = {
    current: formatMonthMeta(now.getFullYear(), now.getMonth()),
    previous: formatMonthMeta(prevDate.getFullYear(), prevDate.getMonth()),
  };

  if (allDates[0]) {
    const ref = new Date(allDates[0]!);
    if (!isNaN(ref.getTime())) {
      const p = new Date(ref.getFullYear(), ref.getMonth() - 1, 1);
      result = {
        current: formatMonthMeta(ref.getFullYear(), ref.getMonth()),
        previous: formatMonthMeta(p.getFullYear(), p.getMonth()),
      };
    }
  }

  result.current.isCurrent = true;
  result.previous.isPrevious = true;
  return result;
}

export function getIssueMonthKey(issue: Issue): string | null {
  if (issue.statusCategory === "done") {
    return getYearMonth(issue.resolvedAt) ?? getYearMonth(issue.updatedAt);
  }
  return (
    getYearMonth(issue.createdAt) ??
    getYearMonth(issue.updatedAt) ??
    getYearMonth(issue.resolvedAt)
  );
}

/**
 * Determine which month an issue belongs to:
 * - Completed issues: resolvedAt month (or updatedAt fallback if done without resolvedAt).
 * - Open/In-progress/To Do issues: createdAt month (or updatedAt fallback).
 * Returns "current" | "previous" | null.
 *
 * Strict constraint: ONLY returns "current" or "previous". If the ticket belongs
 * to any other month (earlier or future), returns null so it is excluded.
 */
export function getIssueMonthRole(
  issue: Issue,
  currentKey: string,
  prevKey: string,
): "current" | "previous" | null {
  if (issue.statusCategory === "done") {
    const resolvedMonth = getYearMonth(issue.resolvedAt) ?? getYearMonth(issue.updatedAt);
    if (resolvedMonth === currentKey) return "current";
    if (resolvedMonth === prevKey) return "previous";
    return null; // Excluded! (resolved in a different month)
  }

  const createdMonth = getYearMonth(issue.createdAt);
  if (createdMonth === currentKey) return "current";
  if (createdMonth === prevKey) return "previous";

  const updatedMonth = getYearMonth(issue.updatedAt);
  if (updatedMonth === currentKey) return "current";
  if (updatedMonth === prevKey) return "previous";

  return null; // Excluded! (created/updated in a different month)
}

export async function computeMonthlyReport(
  boardId: string,
): Promise<MonthlyReportData> {
  const db = getDb();
  const sprints = await db
    .select()
    .from(schema.jiraSprints)
    .where(eq(schema.jiraSprints.boardId, boardId));

  if (sprints.length === 0) {
    throw new Error("No sprints found for board");
  }

  const sprintIds = sprints.map((s) => s.id);
  const [rawIssues, rawWorklogs, excludedAccountIds] = await Promise.all([
    db.select().from(schema.jiraIssues).where(inArray(schema.jiraIssues.sprintId, sprintIds)),
    db.select().from(schema.jiraWorklogs).where(inArray(schema.jiraWorklogs.sprintId, sprintIds)),
    getExcludedAccountIds(),
  ]);

  // Exclude deactivated accounts and user-excluded members
  const reportableIssues = rawIssues.filter((i) => isReportableIssue(i, excludedAccountIds));
  const worklogs = reportableWorklogs(rawWorklogs, excludedAccountIds);

  // Deduplicate issues by issue.key (an issue might appear under multiple sprints)
  // Prefer the row with resolvedAt or the most recently updated one
  const dedupedIssuesMap = new Map<string, Issue>();
  for (const issue of reportableIssues) {
    const existing = dedupedIssuesMap.get(issue.key);
    if (!existing) {
      dedupedIssuesMap.set(issue.key, issue);
    } else {
      const existingTime = Date.parse(existing.resolvedAt ?? existing.updatedAt ?? existing.createdAt ?? "");
      const issueTime = Date.parse(issue.resolvedAt ?? issue.updatedAt ?? issue.createdAt ?? "");
      if (issueTime > existingTime) {
        dedupedIssuesMap.set(issue.key, issue);
      }
    }
  }
  const uniqueIssues = [...dedupedIssuesMap.values()];

  // Calculate target current and previous months as reference
  const targetMonths = resolveTargetMonths(uniqueIssues, sprints);
  const targetYear = targetMonths.current.year;
  const currentKey = targetMonths.current.key;
  const prevKey = targetMonths.previous.key;

  // Collect available years
  const yearsSet = new Set<number>();
  yearsSet.add(targetYear);
  for (const issue of uniqueIssues) {
    const ym = getIssueMonthKey(issue);
    if (ym) {
      const y = parseInt(ym.slice(0, 4), 10);
      if (!isNaN(y)) yearsSet.add(y);
    }
  }
  const availableYears = Array.from(yearsSet).sort((a, b) => b - a);

  // Group worklogs by issue and by month key
  const secondsByIssue = new Map<string, number>();
  const worklogsByMonthKey = new Map<string, Worklog[]>();

  for (const w of worklogs) {
    secondsByIssue.set(w.issueKey, (secondsByIssue.get(w.issueKey) ?? 0) + w.timeSpentSeconds);
    const m = getYearMonth(w.started);
    if (m) {
      const list = worklogsByMonthKey.get(m) ?? [];
      list.push(w);
      worklogsByMonthKey.set(m, list);
    }
  }

  // Map each issue to its month
  const allIssuesWithMeta: MonthlyIssueItem[] = [];
  for (const issue of uniqueIssues) {
    const key = getIssueMonthKey(issue) ?? currentKey;
    const mNum = parseInt(key.slice(5, 7), 10);
    const monthShort = SHORT_MONTH_NAMES[mNum - 1] ?? "Unknown";
    const role: "current" | "previous" | "other" =
      key === currentKey ? "current" : key === prevKey ? "previous" : "other";

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
      loggedHours: toHours(secondsByIssue.get(issue.key) ?? 0),
      monthRole: role,
      monthKey: key,
      monthShort,
    });
  }

  // Generate all 12 months for every available year, newest year first.
  const months: MonthMeta[] = [];
  for (const year of availableYears) {
    for (let m = 0; m < 12; m++) {
      const monthNum = m + 1;
      const monthKey = `${year}-${String(monthNum).padStart(2, "0")}`;
      const count = allIssuesWithMeta.filter((i) => i.monthKey === monthKey).length;
      const meta = formatMonthMeta(year, m, count);
      meta.isCurrent = monthKey === currentKey;
      meta.isPrevious = monthKey === prevKey;
      months.push(meta);
    }
  }

  function buildMonthData(
    meta: MonthMeta,
    monthIssues: MonthlyIssueItem[],
    monthWorklogs: Worklog[],
  ): MonthlyMonthData {
    const points = (i: MonthlyIssueItem) => i.storyPoints ?? 0;

    const committedPoints = round1(monthIssues.reduce((sum, i) => sum + points(i), 0));
    const doneIssues = monthIssues.filter((i) => i.statusCategory === "done");
    const completedPoints = round1(doneIssues.reduce((sum, i) => sum + points(i), 0));
    const remainingPoints = round1(committedPoints - completedPoints);
    const completionPct = committedPoints > 0 ? round1((completedPoints / committedPoints) * 100) : 0;

    const todoCount = monthIssues.filter((i) => i.statusCategory === "new").length;
    const inProgressCount = monthIssues.filter((i) => i.statusCategory === "indeterminate").length;
    const doneCount = doneIssues.length;

    const statusBuckets: Record<StatusBucket, number> = {
      todo: 0,
      "in-progress": 0,
      completed: 0,
      deployed: 0,
    };
    for (const i of monthIssues) statusBuckets[i.bucket] += 1;

    // Team breakdown for this month
    const teamMap = new Map<string, MonthlyMemberPerformance>();
    const emptyRow = (accountId: string, name: string): MonthlyMemberPerformance => ({
      assigneeAccountId: accountId,
      assigneeName: name,
      committedPoints: 0,
      completedPoints: 0,
      totalCount: 0,
      doneCount: 0,
      loggedHours: 0,
    });

    for (const issue of monthIssues) {
      const key = issue.assigneeAccountId ?? "unassigned";
      const row = teamMap.get(key) ?? emptyRow(issue.assigneeAccountId ?? "", issue.assigneeName ?? "Unassigned");
      row.committedPoints += points(issue);
      row.totalCount += 1;
      if (issue.statusCategory === "done") {
        row.completedPoints += points(issue);
        row.doneCount += 1;
      }
      teamMap.set(key, row);
    }

    // Add logged hours from worklogs in this month
    const loggedByAuthor = new Map<string, { name: string; seconds: number }>();
    for (const w of monthWorklogs) {
      const key = w.authorAccountId ?? "unassigned";
      const existing = loggedByAuthor.get(key) ?? { name: w.authorName ?? "Unknown", seconds: 0 };
      existing.seconds += w.timeSpentSeconds;
      loggedByAuthor.set(key, existing);
    }
    for (const [accountId, val] of loggedByAuthor) {
      const row = teamMap.get(accountId) ?? emptyRow(accountId, val.name);
      row.loggedHours = toHours(val.seconds);
      teamMap.set(accountId, row);
    }

    const team = [...teamMap.values()]
      .map((row) => ({
        ...row,
        committedPoints: round1(row.committedPoints),
        completedPoints: round1(row.completedPoints),
      }))
      .sort((a, b) => b.completedPoints - a.completedPoints || b.committedPoints - a.committedPoints);

    const loggedSeconds = monthWorklogs.reduce((sum, w) => sum + w.timeSpentSeconds, 0);

    return {
      meta,
      totals: {
        issueCount: monthIssues.length,
        committedPoints,
        completedPoints,
        remainingPoints,
        completionPct,
        doneCount,
        inProgressCount,
        todoCount,
        loggedHours: toHours(loggedSeconds),
        worklogEntryCount: monthWorklogs.length,
      },
      statusBuckets,
      team,
      issues: monthIssues.sort((a, b) => {
        const da = a.resolvedAt ?? a.updatedAt ?? a.createdAt ?? "";
        const db = b.resolvedAt ?? b.updatedAt ?? b.createdAt ?? "";
        return db.localeCompare(da);
      }),
    };
  }

  // Populate byMonth dictionary.
  // Short-name aliases (e.g. "jan") are registered oldest-first so the most
  // recent year's entry wins when there are multiple Januaries.
  const byMonth: Record<string, MonthlyMonthData> = {};
  for (const meta of [...months].reverse()) {
    const monthIssues = allIssuesWithMeta.filter((i) => i.monthKey === meta.key);
    const monthWorklogs = worklogsByMonthKey.get(meta.key) ?? [];
    const data = buildMonthData(meta, monthIssues, monthWorklogs);
    byMonth[meta.key] = data;
    byMonth[meta.shortMonthName.toLowerCase()] = data;
    byMonth[meta.shortMonthName] = data;
  }

  const current = byMonth[currentKey] ?? buildMonthData(targetMonths.current, [], []);
  const previous = byMonth[prevKey] ?? buildMonthData(targetMonths.previous, [], []);
  byMonth["current"] = current;
  byMonth["previous"] = previous;

  const completedPointsDelta = round1(current.totals.completedPoints - previous.totals.completedPoints);
  const completedPointsPctDelta =
    previous.totals.completedPoints > 0
      ? round1(((current.totals.completedPoints - previous.totals.completedPoints) / previous.totals.completedPoints) * 100)
      : null;

  return {
    boardId,
    year: targetYear,
    availableYears,
    months,
    byMonth,
    meta: targetMonths,
    current,
    previous,
    comparison: {
      completedPointsDelta,
      completedPointsPctDelta,
      committedPointsDelta: round1(current.totals.committedPoints - previous.totals.committedPoints),
      doneCountDelta: current.totals.doneCount - previous.totals.doneCount,
      issueCountDelta: current.totals.issueCount - previous.totals.issueCount,
      loggedHoursDelta: round1(current.totals.loggedHours - previous.totals.loggedHours),
    },
    allIssues: allIssuesWithMeta.sort((a, b) => {
      const da = a.resolvedAt ?? a.updatedAt ?? a.createdAt ?? "";
      const db = b.resolvedAt ?? b.updatedAt ?? b.createdAt ?? "";
      return db.localeCompare(da);
    }),
  };
}
