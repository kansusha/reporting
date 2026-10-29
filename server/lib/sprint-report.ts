import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../db.js";
import { getExcludedAccountIds } from "./excluded-members.js";
import { getJiraConfig } from "./jira.js";
import { sprintWorklogWindow, type WorklogWindow } from "./worklog-window.js";

type Sprint = typeof schema.jiraSprints.$inferSelect;
type Issue = typeof schema.jiraIssues.$inferSelect;
type Worklog = typeof schema.jiraWorklogs.$inferSelect;
export type SprintRole = "current" | "previous";

// sync-jira-sprint-data keeps at most one row per role ("current" and
// "previous") per board, so this is always a single lookup, never "most
// recent N".
export async function getSprintByRole(
  role: SprintRole,
  boardId: string,
): Promise<Sprint | null> {
  const db = getDb();
  const [sprint] = await db
    .select()
    .from(schema.jiraSprints)
    .where(and(eq(schema.jiraSprints.role, role), eq(schema.jiraSprints.boardId, boardId)))
    .limit(1);
  return sprint ?? null;
}

export async function getSprintReportByRole(
  role: SprintRole,
  boardId: string,
): Promise<ReturnType<typeof computeSprintReport> | null> {
  const sprint = await getSprintByRole(role, boardId);
  if (!sprint) return null;
  const { issues, worklogs, excludedAccountIds, worklogWindow } = await loadSprintData(sprint);
  return computeSprintReport(sprint, issues, excludedAccountIds, worklogs, worklogWindow);
}

export async function loadSprintData(sprint: Sprint) {
  const db = getDb();
  const [issues, worklogs, excludedAccountIds, config] = await Promise.all([
    db.select().from(schema.jiraIssues).where(eq(schema.jiraIssues.sprintId, sprint.id)),
    db.select().from(schema.jiraWorklogs).where(eq(schema.jiraWorklogs.sprintId, sprint.id)),
    getExcludedAccountIds(),
    getJiraConfig(),
  ]);
  const worklogWindow = sprintWorklogWindow(sprint, config.timeZone ?? "UTC");
  return { issues, worklogs, excludedAccountIds, worklogWindow };
}

// Reports only count work owned by an active team member: unassigned issues
// and issues still assigned to a deactivated Jira account are excluded
// everywhere (totals, status breakdown, team, carry-forward, ticket list,
// CSV export). assigneeActive is null for rows synced before that column
// existed; treat that as unknown/active rather than hiding everything until
// the next sync.
// Members the user excluded (see excluded-members.ts) are left out the same way.
export function isReportableIssue(
  issue: Issue,
  excludedAccountIds: ReadonlySet<string> = new Set(),
): boolean {
  return (
    Boolean(issue.assigneeAccountId) &&
    issue.assigneeActive !== false &&
    !excludedAccountIds.has(issue.assigneeAccountId!)
  );
}

// Work log is counted like a Timela timesheet: every worklog on the board's
// projects within the sprint's date range (see worklog-window.ts), on any
// ticket — in the sprint or not, assigned or not. Only the author side is
// filtered: time by deactivated accounts or user-excluded members is left
// out.
export function reportableWorklogs(
  worklogs: Worklog[],
  excludedAccountIds: ReadonlySet<string> = new Set(),
): Worklog[] {
  return worklogs.filter(
    (w) =>
      Boolean(w.authorAccountId) &&
      w.authorActive !== false &&
      !excludedAccountIds.has(w.authorAccountId!),
  );
}

// Ticket filter buckets used by the Ticket details view and list-sprint-issues.
// "Deployed" is a workflow status name, not a Jira status category, so it's
// matched by name first and takes precedence over the category (a Deployed
// status may sit in either "In Progress" or "Done" depending on the workflow).
export const STATUS_BUCKETS = ["todo", "in-progress", "completed", "deployed"] as const;
export type StatusBucket = (typeof STATUS_BUCKETS)[number];

export function statusBucket(issue: Pick<Issue, "status" | "statusCategory">): StatusBucket {
  if (/deploy/i.test(issue.status)) return "deployed";
  if (issue.statusCategory === "done") return "completed";
  if (issue.statusCategory === "indeterminate") return "in-progress";
  return "todo";
}

export function toHours(seconds: number): number {
  return Math.round((seconds / 3600) * 10) / 10;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function computeSprintReport(
  sprint: Sprint,
  allIssues: Issue[],
  excludedAccountIds: ReadonlySet<string> = new Set(),
  allWorklogs: Worklog[] = [],
  worklogWindow: WorklogWindow | null = null,
) {
  const issues = allIssues.filter((i) => isReportableIssue(i, excludedAccountIds));
  // Summaries for any synced sprint ticket; work can also be logged on
  // tickets outside the sprint, which have only a key.
  const issueByKey = new Map(allIssues.map((i) => [i.key, i]));
  const worklogs = reportableWorklogs(allWorklogs, excludedAccountIds);
  const loggedSecondsByIssue = new Map<string, number>();
  const loggedByAuthor = new Map<
    string,
    { name: string; seconds: number; entryCount: number }
  >();
  for (const w of worklogs) {
    loggedSecondsByIssue.set(
      w.issueKey,
      (loggedSecondsByIssue.get(w.issueKey) ?? 0) + w.timeSpentSeconds,
    );
    const author = loggedByAuthor.get(w.authorAccountId!) ?? {
      name: w.authorName ?? "Unknown",
      seconds: 0,
      entryCount: 0,
    };
    author.seconds += w.timeSpentSeconds;
    author.entryCount += 1;
    loggedByAuthor.set(w.authorAccountId!, author);
  }
  const loggedSeconds = worklogs.reduce((sum, w) => sum + w.timeSpentSeconds, 0);
  const points = (issue: Issue) => issue.storyPoints ?? 0;

  const committedPoints = round1(issues.reduce((sum, i) => sum + points(i), 0));
  const doneIssues = issues.filter((i) => i.statusCategory === "done");
  const completedPoints = round1(doneIssues.reduce((sum, i) => sum + points(i), 0));
  const remainingPoints = round1(committedPoints - completedPoints);
  const completionPct =
    committedPoints > 0 ? round1((completedPoints / committedPoints) * 100) : 0;

  const todoCount = issues.filter((i) => i.statusCategory === "new").length;
  const inProgressCount = issues.filter(
    (i) => i.statusCategory === "indeterminate",
  ).length;
  const doneCount = doneIssues.length;

  const statusBuckets: Record<StatusBucket, number> = {
    todo: 0,
    "in-progress": 0,
    completed: 0,
    deployed: 0,
  };
  for (const issue of issues) statusBuckets[statusBucket(issue)] += 1;

  const statusBreakdownMap = new Map<
    string,
    { status: string; statusCategory: string; count: number }
  >();
  for (const issue of issues) {
    const existing = statusBreakdownMap.get(issue.status);
    if (existing) existing.count += 1;
    else
      statusBreakdownMap.set(issue.status, {
        status: issue.status,
        statusCategory: issue.statusCategory,
        count: 1,
      });
  }

  const teamMap = new Map<
    string,
    {
      assigneeAccountId: string | null;
      assigneeName: string;
      committedPoints: number;
      completedPoints: number;
      totalCount: number;
      doneCount: number;
      loggedHours: number;
    }
  >();
  const emptyRow = (accountId: string, name: string) => ({
    assigneeAccountId: accountId,
    assigneeName: name,
    committedPoints: 0,
    completedPoints: 0,
    totalCount: 0,
    doneCount: 0,
    loggedHours: 0,
  });
  for (const issue of issues) {
    // isReportableIssue guarantees an assignee.
    const key = issue.assigneeAccountId!;
    const existing =
      teamMap.get(key) ?? emptyRow(key, issue.assigneeName ?? "Unassigned");
    existing.committedPoints += points(issue);
    existing.totalCount += 1;
    if (issue.statusCategory === "done") {
      existing.completedPoints += points(issue);
      existing.doneCount += 1;
    }
    teamMap.set(key, existing);
  }
  // Hours go to whoever logged them; someone who only logged time on others'
  // tickets still gets a team row (with zero points of their own).
  for (const [accountId, logged] of loggedByAuthor) {
    const row = teamMap.get(accountId) ?? emptyRow(accountId, logged.name);
    row.loggedHours = toHours(logged.seconds);
    teamMap.set(accountId, row);
  }
  const team = [...teamMap.values()]
    .map((row) => ({
      ...row,
      committedPoints: round1(row.committedPoints),
      completedPoints: round1(row.completedPoints),
    }))
    .sort(
      (a, b) => b.committedPoints - a.committedPoints || b.loggedHours - a.loggedHours,
    );

  const workLog = {
    window: worklogWindow,
    byMember: [...loggedByAuthor]
      .map(([accountId, logged]) => ({
        accountId,
        name: logged.name,
        loggedHours: toHours(logged.seconds),
        entryCount: logged.entryCount,
      }))
      .sort((a, b) => b.loggedHours - a.loggedHours),
    byIssue: [...loggedSecondsByIssue]
      .map(([key, seconds]) => ({
        key,
        summary: issueByKey.get(key)?.summary ?? "",
        assigneeName: issueByKey.get(key)?.assigneeName ?? "",
        inSprint: issueByKey.has(key),
        loggedHours: toHours(seconds),
      }))
      .sort((a, b) => b.loggedHours - a.loggedHours),
    entries: worklogs
      .map((w) => ({
        id: w.id,
        issueKey: w.issueKey,
        summary: issueByKey.get(w.issueKey)?.summary ?? "",
        inSprint: issueByKey.has(w.issueKey),
        authorName: w.authorName ?? "Unknown",
        hours: toHours(w.timeSpentSeconds),
        started: w.started,
      }))
      .sort((a, b) => b.started.localeCompare(a.started)),
  };

  const carryForward = issues
    .filter((i) => i.statusCategory !== "done")
    .map((i) => ({
      key: i.key,
      summary: i.summary,
      status: i.status,
      assigneeName: i.assigneeName ?? "Unassigned",
      storyPoints: i.storyPoints,
      loggedHours: toHours(loggedSecondsByIssue.get(i.key) ?? 0),
    }));

  return {
    sprint: {
      id: sprint.id,
      boardId: sprint.boardId,
      boardName: sprint.boardName,
      name: sprint.name,
      state: sprint.state,
      goal: sprint.goal,
      startDate: sprint.startDate,
      endDate: sprint.endDate,
      completeDate: sprint.completeDate,
      syncedAt: sprint.syncedAt,
    },
    totals: {
      issueCount: issues.length,
      committedPoints,
      completedPoints,
      remainingPoints,
      completionPct,
      todoCount,
      inProgressCount,
      doneCount,
      carryForwardCount: carryForward.length,
      loggedHours: toHours(loggedSeconds),
      worklogEntryCount: worklogs.length,
    },
    statusBreakdown: [...statusBreakdownMap.values()],
    statusBuckets,
    team,
    carryForward,
    workLog,
  };
}

export type SprintReport = ReturnType<typeof computeSprintReport>;
