import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db.js";
import { getExcludedAccountIds } from "../server/lib/excluded-members.js";
import { resolveBoard } from "../server/lib/jira.js";
import {
  STATUS_BUCKETS,
  getSprintByRole,
  isReportableIssue,
  reportableWorklogs,
  statusBucket,
  toHours,
} from "../server/lib/sprint-report.js";

export default defineAction({
  description:
    "List tickets in one board's current sprint (the selected board unless `boardId` is given) that are assigned to an active team member (unassigned, deactivated-assignee, and user-excluded members' tickets are left out), optionally filtered by status bucket (To Do / In Progress / Completed / Deployed), status category, or assignee. Each ticket includes `loggedHours` — time logged on it within the sprint's date range by active, non-excluded people. Use for ticket-detail views; use get-sprint-report for aggregate totals.",
  schema: z.object({
    bucket: z
      .enum(STATUS_BUCKETS)
      .optional()
      .describe('Ticket filter as shown in the UI: "todo", "in-progress", "completed" (Done category, not Deployed), or "deployed" (status name contains "deploy", any category). Each returned ticket also carries its `bucket`.'),
    statusCategory: z
      .enum(["new", "indeterminate", "done"])
      .optional()
      .describe('Filter by Jira status category: "new" (To Do), "indeterminate" (In Progress), or "done".'),
    boardId: z
      .string()
      .optional()
      .describe("Configured board id; defaults to the selected board (see get-jira-connection)."),
    assigneeAccountId: z
      .string()
      .optional()
      .describe("Filter to one assignee's Jira account id."),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ boardId, bucket, statusCategory, assigneeAccountId }) => {
    const board = await resolveBoard(boardId);
    const sprint = await getSprintByRole("current", board.boardId);
    if (!sprint) {
      fail(
        `No sprint has been synced yet for "${board.boardName}". Call sync-jira-sprint-data first.`,
        { errorCode: "not_synced" },
      );
    }

    const db = getDb();
    const conditions = [eq(schema.jiraIssues.sprintId, sprint.id)];
    if (statusCategory)
      conditions.push(eq(schema.jiraIssues.statusCategory, statusCategory));
    if (assigneeAccountId)
      conditions.push(
        eq(schema.jiraIssues.assigneeAccountId, assigneeAccountId),
      );

    const issues = await db
      .select()
      .from(schema.jiraIssues)
      .where(and(...conditions));
    const excluded = await getExcludedAccountIds();
    const reportable = issues.filter((i) => isReportableIssue(i, excluded));
    const worklogs = reportableWorklogs(
      await db
        .select()
        .from(schema.jiraWorklogs)
        .where(eq(schema.jiraWorklogs.sprintId, sprint.id)),
      excluded,
    );
    const seconds = new Map<string, number>();
    for (const w of worklogs) {
      seconds.set(w.issueKey, (seconds.get(w.issueKey) ?? 0) + w.timeSpentSeconds);
    }
    return reportable
      .map((i) => ({
        ...i,
        bucket: statusBucket(i),
        loggedHours: toHours(seconds.get(i.key) ?? 0),
      }))
      .filter((i) => !bucket || i.bucket === bucket);
  },
});
