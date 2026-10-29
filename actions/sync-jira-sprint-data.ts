/**
 * Pull one configured board's current sprint (active, or most recently
 * closed if none is active) plus the sprint immediately before it, and their
 * issues, from Jira Cloud into the local cache — replacing only that board's
 * rows. Deterministic — no LLM calls.
 */

import { defineAction, fail } from "@agent-native/core/action";
import { eq, inArray } from "@agent-native/core/db/schema";
import { notInArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db.js";
import {
  getJiraConfig,
  jiraRequest,
  putJiraConfig,
  resolveBoard,
  resolveJiraTimeZone,
  resolveStoryPointsFieldIds,
} from "../server/lib/jira.js";
import {
  isInWindow,
  sprintWorklogWindow,
  type WorklogWindow,
} from "../server/lib/worklog-window.js";

// Bump when the work log counting rules change, so a reused previous-sprint
// snapshot stored under older rules is downloaded again.
const WORKLOG_SCHEME = 2;

interface JiraSprintSummary {
  id: number;
  name: string;
  state: string;
  goal?: string;
  startDate?: string;
  endDate?: string;
  completeDate?: string;
  originBoardId?: number;
}

interface JiraSprintsResponse {
  values: JiraSprintSummary[];
  isLast?: boolean;
}

interface JiraWorklog {
  id: string;
  author?: { accountId: string; displayName: string; active: boolean } | null;
  started: string;
  timeSpentSeconds: number;
}

interface JiraWorklogPage {
  startAt: number;
  maxResults: number;
  total: number;
  worklogs: JiraWorklog[];
}

interface JiraIssueFields {
  summary: string;
  status: { name: string; statusCategory: { key: string } };
  issuetype: { name: string; subtask?: boolean };
  priority?: { name: string } | null;
  assignee?: { accountId: string; displayName: string; active: boolean } | null;
  project: { key: string };
  created?: string;
  updated?: string;
  resolutiondate?: string | null;
  worklog?: JiraWorklogPage;
  subtasks?: Array<{ key: string }>;
  [customField: string]: unknown;
}

interface JiraIssue {
  key: string;
  fields: JiraIssueFields;
}

interface JiraSprintIssuesResponse {
  issues: JiraIssue[];
  startAt: number;
  maxResults: number;
  total: number;
}

async function listBoardSprints(
  boardId: string,
  state: "active" | "closed",
): Promise<JiraSprintSummary[]> {
  // Jira returns a board's sprints oldest first, so a board with a long
  // history has its most recent closed sprints on the last page — read
  // every page rather than just the first.
  const sprints: JiraSprintSummary[] = [];
  let startAt = 0;
  for (;;) {
    const page = await jiraRequest<JiraSprintsResponse>(
      `/rest/agile/1.0/board/${boardId}/sprint`,
      { query: { state, startAt, maxResults: 50 } },
    );
    sprints.push(...page.values);
    startAt += page.values.length;
    if (page.isLast !== false || page.values.length === 0) break;
  }
  return sprints;
}

// A board's sprint list also includes sprints owned by other boards whose
// filters share issues. Prefer the board's own sprints (originBoardId) so
// each sprint is reported under the board it belongs to, falling back to
// everything listed if the board owns none.
function preferOwnSprints(
  boardId: string,
  sprints: JiraSprintSummary[],
): JiraSprintSummary[] {
  const own = sprints.filter((s) => String(s.originBoardId) === boardId);
  return own.length > 0 ? own : sprints;
}

async function findCurrentAndPreviousSprints(
  boardId: string,
): Promise<{ current: JiraSprintSummary; previous: JiraSprintSummary | null }> {
  const [active, closed] = await Promise.all([
    listBoardSprints(boardId, "active"),
    listBoardSprints(boardId, "closed"),
  ]);
  const newestFirst = (key: (s: JiraSprintSummary) => string | undefined) =>
    (a: JiraSprintSummary, b: JiraSprintSummary) =>
      (key(b) ?? "").localeCompare(key(a) ?? "");
  const activeSorted = preferOwnSprints(boardId, active).sort(
    newestFirst((s) => s.startDate),
  );
  const closedSorted = preferOwnSprints(boardId, closed).sort(
    newestFirst((s) => s.completeDate ?? s.endDate),
  );

  if (activeSorted.length > 0) {
    return { current: activeSorted[0], previous: closedSorted[0] ?? null };
  }
  if (closedSorted.length === 0) {
    fail("This board has no active or closed sprints to report on.", {
      errorCode: "not_found",
    });
  }
  return { current: closedSorted[0], previous: closedSorted[1] ?? null };
}

async function fetchAllSprintIssues(
  boardId: string,
  sprintId: number,
  storyPointsFieldIds: string[],
): Promise<JiraIssue[]> {
  const coreFields = [
    "summary",
    "status",
    "issuetype",
    "priority",
    "assignee",
    "project",
    "created",
    "updated",
    "resolutiondate",
    "subtasks",
    ...storyPointsFieldIds,
  ];
  const fields = coreFields.join(",");

  const fetchPage = (startAt: number) =>
    jiraRequest<JiraSprintIssuesResponse>(
      `/rest/agile/1.0/board/${boardId}/sprint/${sprintId}/issue`,
      { query: { fields, startAt, maxResults: 100 } },
    );
  // The first page reports the total and the page size Jira actually granted
  // (it may cap below 100); fetch the remaining pages in parallel.
  const first = await fetchPage(0);
  const pageSize = first.issues.length;
  const allPages = pageSize === 0 || pageSize >= first.total
    ? [first]
    : [first, ...await mapLimited(
        Array.from({ length: Math.ceil((first.total - pageSize) / pageSize) }, (_, i) => (i + 1) * pageSize),
        4,
        fetchPage,
      )];
  const parentIssues = allPages.flatMap((page) => page.issues);

  // Collect sub-task keys from all parents (board endpoint doesn't return them)
  const subtaskKeys = [
    ...new Set(
      parentIssues.flatMap((i) => (i.fields.subtasks ?? []).map((s) => s.key)),
    ),
  ];
  if (subtaskKeys.length === 0) return parentIssues;

  // Batch-fetch sub-task full details via /search/jql in chunks of 50
  const CHUNK = 50;
  const subtaskIssues: JiraIssue[] = [];
  for (let i = 0; i < subtaskKeys.length; i += CHUNK) {
    const chunk = subtaskKeys.slice(i, i + CHUNK);
    const jql = `key in (${chunk.map(jqlString).join(", ")})`;
    let nextPageToken: string | undefined;
    for (;;) {
      const page = await jiraRequest<{ issues: JiraIssue[]; nextPageToken?: string; isLast?: boolean }>(
        "/rest/api/3/search/jql",
        { query: { jql, fields, maxResults: 50, nextPageToken } },
      );
      subtaskIssues.push(...page.issues);
      nextPageToken = page.nextPageToken;
      if (page.isLast !== false || !nextPageToken || page.issues.length === 0) break;
    }
  }

  // Merge: parent issues first, then sub-tasks (deduplicated)
  const seen = new Set(parentIssues.map((i) => i.key));
  const newSubtasks = subtaskIssues.filter((i) => !seen.has(i.key));
  return [...parentIssues, ...newSubtasks];
}

interface JiraJqlSearchResponse {
  issues: { key: string; fields: { worklog?: JiraWorklogPage } }[];
  nextPageToken?: string;
  isLast?: boolean;
}

async function listBoardProjectKeys(boardId: string): Promise<string[]> {
  const keys: string[] = [];
  let startAt = 0;
  for (;;) {
    const page = await jiraRequest<{ values: { key: string }[]; isLast?: boolean }>(
      `/rest/agile/1.0/board/${boardId}/project`,
      { query: { startAt, maxResults: 50 } },
    );
    keys.push(...page.values.map((p) => p.key));
    startAt += page.values.length;
    if (page.isLast !== false || page.values.length === 0) break;
  }
  return keys;
}

function jqlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// Every worklog on the board's projects whose day (in the Jira user's time
// zone) falls in the sprint window — the same set a Timela timesheet over
// those projects and dates sums, whether or not the ticket is in the sprint.
async function fetchWindowWorklogs(
  projectKeys: string[],
  window: WorklogWindow,
): Promise<{ issueKey: string; log: JiraWorklog }[]> {
  if (projectKeys.length === 0) return [];
  const jql =
    `project in (${projectKeys.map(jqlString).join(", ")}) ` +
    `AND worklogDate >= "${window.from}" AND worklogDate <= "${window.to}"`;

  const issues: JiraJqlSearchResponse["issues"] = [];
  let nextPageToken: string | undefined;
  for (;;) {
    const page = await jiraRequest<JiraJqlSearchResponse>("/rest/api/3/search/jql", {
      query: { jql, fields: "worklog", maxResults: 100, nextPageToken },
    });
    issues.push(...page.issues);
    nextPageToken = page.nextPageToken;
    if (page.isLast !== false || !nextPageToken || page.issues.length === 0) break;
  }

  // Day boundaries are in the user's zone; widen the server-side timestamp
  // filter by a day either side and filter exactly by day afterwards.
  const DAY_MS = 24 * 60 * 60 * 1000;
  const startedAfter = Date.parse(`${window.from}T00:00:00Z`) - DAY_MS;
  const startedBefore = Date.parse(`${window.to}T23:59:59Z`) + DAY_MS;

  const perIssue = await mapLimited(issues, 8, async (issue) => {
    const embedded = issue.fields.worklog;
    let worklogs = embedded?.worklogs ?? [];
    // The embedded field holds only the first ~20 entries.
    if (!embedded || embedded.total > worklogs.length) {
      worklogs = [];
      let startAt = 0;
      for (;;) {
        const page = await jiraRequest<JiraWorklogPage>(
          `/rest/api/3/issue/${encodeURIComponent(issue.key)}/worklog`,
          { query: { startAt, maxResults: 1000, startedAfter, startedBefore } },
        );
        worklogs.push(...page.worklogs);
        startAt += page.worklogs.length;
        if (startAt >= page.total || page.worklogs.length === 0) break;
      }
    }
    return worklogs
      .filter((w) => isInWindow(w.started, window))
      .map((log) => ({ issueKey: issue.key, log }));
  });
  return perIssue.flat();
}

// Small fixed concurrency so a sprint with many heavily-logged issues doesn't
// fire hundreds of Jira requests at once.
async function mapLimited<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    }),
  );
  return results;
}

function storyPointsOf(issue: JiraIssue, fieldIds: string[]): number | null {
  for (const id of fieldIds) {
    const value = issue.fields[id];
    if (typeof value === "number") return value;
  }
  return null;
}

export default defineAction({
  description:
    "Sync one configured Jira board's current sprint (active, or the most recently closed one) plus the sprint immediately before it, their issues, and the work log entries logged on those issues during each sprint, into this app's database. Defaults to the selected board; pass `boardId` for another configured board. Each board's data is kept separately. The previous sprint is only downloaded again if it changed since it closed (pass `full: true` to force). Returns `timingsMs` per phase. Call this before get-sprint-report / get-sprint-comparison / list-sprint-issues when data may be stale, or when the user asks to refresh the report.",
  schema: z.object({
    boardId: z
      .string()
      .optional()
      .describe("Configured board id; defaults to the selected board."),
    full: z
      .boolean()
      .default(false)
      .describe("Re-download the previous (closed) sprint too, instead of reusing its post-close snapshot."),
  }),
  run: async ({ boardId: requestedBoardId, full }) => {
    const board = await resolveBoard(requestedBoardId);
    const boardId = board.boardId;

    const startedAt = Date.now();
    const lap = (() => {
      let last = startedAt;
      return () => {
        const now = Date.now();
        const ms = now - last;
        last = now;
        return ms;
      };
    })();

    const [{ current, previous }, storyPointsFieldIds, timeZone, projectKeys] =
      await Promise.all([
        findCurrentAndPreviousSprints(boardId),
        resolveStoryPointsFieldIds(),
        resolveJiraTimeZone(),
        listBoardProjectKeys(boardId),
      ]);
    const sprintsMs = lap();

    // Row ids are board-scoped: a sprint shared between two boards' filters
    // is stored once per board so syncing one board never touches another's.
    const rowId = (sprint: JiraSprintSummary) => `${boardId}:${sprint.id}`;
    const db = getDb();

    // A closed sprint's snapshot taken after it closed (same completeDate)
    // doesn't need re-downloading on every sync — reuse it unless `full`.
    let reusePrevious = false;
    const configBefore = await getJiraConfig();
    const schemeCurrent = configBefore.worklogSchemeByBoard[boardId] === WORKLOG_SCHEME;
    if (previous && !full && schemeCurrent) {
      const [existing] = await db
        .select()
        .from(schema.jiraSprints)
        .where(eq(schema.jiraSprints.id, rowId(previous)))
        .limit(1);
      reusePrevious =
        existing?.state === "closed" &&
        Boolean(previous.completeDate) &&
        existing.completeDate === previous.completeDate;
    }

    const sprintsToFetch = [current, ...(previous && !reusePrevious ? [previous] : [])];
    const issuesBySprint = new Map<number, JiraIssue[]>();
    const worklogsBySprint = new Map<number, { issueKey: string; log: JiraWorklog }[]>();
    let issuesMs = 0;
    let worklogsMs = 0;
    await Promise.all(
      sprintsToFetch.map(async (sprint) => {
        const t0 = Date.now();
        const issues = await fetchAllSprintIssues(boardId, sprint.id, storyPointsFieldIds);
        issuesBySprint.set(sprint.id, issues);
        const t1 = Date.now();
        const window = sprintWorklogWindow(sprint, timeZone);
        worklogsBySprint.set(
          sprint.id,
          window ? await fetchWindowWorklogs(projectKeys, window) : [],
        );
        issuesMs = Math.max(issuesMs, t1 - t0);
        worklogsMs = Math.max(worklogsMs, Date.now() - t1);
      }),
    );
    lap();

    const configuredBoardIds = (await getJiraConfig()).boards.map((b) => b.boardId);
    const keepRowIds = new Set(reusePrevious && previous ? [rowId(previous)] : []);

    await db.transaction(async (tx) => {
      // Replace this board's rows outright, and drop rows left behind by
      // boards that are no longer configured.
      const stale = await tx
        .select({ id: schema.jiraSprints.id })
        .from(schema.jiraSprints)
        .where(eq(schema.jiraSprints.boardId, boardId));
      const orphaned = await tx
        .select({ id: schema.jiraSprints.id })
        .from(schema.jiraSprints)
        .where(notInArray(schema.jiraSprints.boardId, configuredBoardIds));
      const dropIds = [...stale, ...orphaned]
        .map((r) => r.id)
        .filter((id) => !keepRowIds.has(id));
      if (dropIds.length > 0) {
        await tx.delete(schema.jiraIssues).where(inArray(schema.jiraIssues.sprintId, dropIds));
        await tx
          .delete(schema.jiraWorklogs)
          .where(inArray(schema.jiraWorklogs.sprintId, dropIds));
        await tx.delete(schema.jiraSprints).where(inArray(schema.jiraSprints.id, dropIds));
      }

      for (const [role, sprint] of [
        ["current", current],
        ...(previous ? [["previous", previous] as const] : []),
      ] as const) {
        const sprintRowId = rowId(sprint);
        if (keepRowIds.has(sprintRowId)) {
          // Reused snapshot: only its role can have changed (e.g. last
          // sync's closed "current" is now "previous").
          await tx
            .update(schema.jiraSprints)
            .set({ role })
            .where(eq(schema.jiraSprints.id, sprintRowId));
          continue;
        }
        await tx.insert(schema.jiraSprints).values({
          id: sprintRowId,
          boardId,
          boardName: board.boardName,
          name: sprint.name,
          state: sprint.state,
          role,
          goal: sprint.goal ?? "",
          startDate: sprint.startDate ?? null,
          endDate: sprint.endDate ?? null,
          completeDate: sprint.completeDate ?? null,
        });

        // Dedupe by key within this sprint's own fetch (defensive — Jira
        // shouldn't repeat an issue across pages, but a duplicate here would
        // otherwise collide on the (sprintId, key) primary key).
        const issues = [
          ...new Map(
            (issuesBySprint.get(sprint.id) ?? []).map((issue) => [issue.key, issue]),
          ).values(),
        ];
        if (issues.length > 0) {
          await tx.insert(schema.jiraIssues).values(
            issues.map((issue) => ({
              id: `${sprintRowId}:${issue.key}`,
              key: issue.key,
              sprintId: sprintRowId,
              projectKey: issue.fields.project?.key ?? "",
              issueType: issue.fields.issuetype?.name ?? "",
              summary: issue.fields.summary ?? "",
              status: issue.fields.status?.name ?? "",
              statusCategory: issue.fields.status?.statusCategory?.key ?? "new",
              assigneeAccountId: issue.fields.assignee?.accountId ?? null,
              assigneeName: issue.fields.assignee?.displayName ?? null,
              assigneeActive: issue.fields.assignee?.active ?? null,
              storyPoints: storyPointsOf(issue, storyPointsFieldIds),
              priority: issue.fields.priority?.name ?? "",
              createdAt: issue.fields.created ?? null,
              updatedAt: issue.fields.updated ?? null,
              resolvedAt: issue.fields.resolutiondate ?? null,
            })),
          );
        }

        // Dedupe by worklog id (the same issue can't repeat within a sprint
        // after the key dedupe above, but stay defensive on the primary key).
        const worklogs = [
          ...new Map(
            (worklogsBySprint.get(sprint.id) ?? []).map((w) => [w.log.id, w]),
          ).values(),
        ];
        if (worklogs.length > 0) {
          await tx.insert(schema.jiraWorklogs).values(
            worklogs.map(({ issueKey, log }) => ({
              id: `${sprintRowId}:${log.id}`,
              sprintId: sprintRowId,
              issueKey,
              authorAccountId: log.author?.accountId ?? null,
              authorName: log.author?.displayName ?? null,
              authorActive: log.author?.active ?? null,
              timeSpentSeconds: log.timeSpentSeconds ?? 0,
              started: log.started,
            })),
          );
        }
      }
    });

    const writeMs = lap();
    if (!schemeCurrent) {
      const latest = await getJiraConfig();
      await putJiraConfig({
        worklogSchemeByBoard: { ...latest.worklogSchemeByBoard, [boardId]: WORKLOG_SCHEME },
      });
    }
    const currentIssueCount = issuesBySprint.get(current.id)?.length ?? 0;
    const currentWorklogCount = worklogsBySprint.get(current.id)?.length ?? 0;
    return {
      boardId,
      boardName: board.boardName,
      sprintId: String(current.id),
      sprintName: current.name,
      sprintState: current.state,
      issueCount: currentIssueCount,
      worklogCount: currentWorklogCount,
      previousSprintName: previous?.name ?? null,
      previousSprintReused: reusePrevious,
      timingsMs: {
        total: Date.now() - startedAt,
        findSprints: sprintsMs,
        issues: issuesMs,
        worklogs: worklogsMs,
        write: writeMs,
      },
      message: previous
        ? `Synced ${currentIssueCount} issue(s) and ${currentWorklogCount} work log entr${currentWorklogCount === 1 ? "y" : "ies"} from "${board.boardName}" sprint "${current.name}" (plus "${previous.name}" for comparison).`
        : `Synced ${currentIssueCount} issue(s) and ${currentWorklogCount} work log entr${currentWorklogCount === 1 ? "y" : "ies"} from "${board.boardName}" sprint "${current.name}". No previous sprint found to compare against.`,
    };
  },
});
