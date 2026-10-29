// App tables live here. Define each table with the framework's portable column
// helpers so the same schema works on local libSQL and hosted Postgres.
//
// After editing this file, run `pnpm db:generate` and restart the dev server
// (see `drizzle/START_HERE.md`).

import { boolean, index, now, real, table, text } from "@agent-native/core/db/schema";

// One row per Jira sprint pulled from the connected board. Scoped to the
// current sprint plus the one immediately before it (see AGENTS.md) — this
// is a cache of Jira's data for fast report reads, not a system of record.
export const jiraSprints = table("jira_sprints", {
  id: text("id").primaryKey(), // Jira sprint id
  boardId: text("board_id").notNull(),
  boardName: text("board_name").notNull().default(""),
  name: text("name").notNull(),
  state: text("state").notNull(), // "active" | "closed" | "future"
  role: text("role").notNull().default("current"), // "current" | "previous"
  goal: text("goal").notNull().default(""),
  startDate: text("start_date"),
  endDate: text("end_date"),
  completeDate: text("complete_date"),
  syncedAt: text("synced_at").notNull().default(now()),
});

// One row per issue in a synced sprint. Keyed by (sprintId, key), not key
// alone — a team-managed board's sprint issue listing isn't guaranteed
// disjoint across sprints, so the same Jira issue can legitimately appear
// under both the current and previous synced sprint.
export const jiraIssues = table(
  "jira_issues",
  {
    id: text("id").primaryKey(), // `${sprintId}:${key}`
    key: text("key").notNull(), // e.g. "PROJ-123"
    sprintId: text("sprint_id").notNull(),
    projectKey: text("project_key").notNull().default(""),
    issueType: text("issue_type").notNull().default(""),
    summary: text("summary").notNull().default(""),
    status: text("status").notNull().default(""),
    // Jira's status category: "new" | "indeterminate" | "done"
    statusCategory: text("status_category").notNull().default("new"),
    assigneeAccountId: text("assignee_account_id"),
    assigneeName: text("assignee_name"),
    // Jira's assignee.active — false for a deactivated/offboarded Atlassian
    // account, null when unassigned. Team performance only counts active
    // assignees (see AGENTS.md).
    assigneeActive: boolean("assignee_active"),
    storyPoints: real("story_points"),
    priority: text("priority").notNull().default(""),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
    resolvedAt: text("resolved_at"),
    syncedAt: text("synced_at").notNull().default(now()),
  },
  (t) => [
    index("jira_issues_sprint_id_idx").on(t.sprintId),
    index("jira_issues_key_idx").on(t.key),
    index("jira_issues_status_category_idx").on(t.statusCategory),
    index("jira_issues_assignee_account_id_idx").on(t.assigneeAccountId),
  ],
);

// One row per Jira worklog entry logged against an issue in a synced sprint,
// limited to entries started inside that sprint's window (start → completion,
// or open-ended while the sprint is active). Keyed by the board-scoped sprint
// row id like jira_issues, and replaced with it on every sync. Attributed to
// the worklog's author, who may differ from the issue's assignee.
export const jiraWorklogs = table(
  "jira_worklogs",
  {
    id: text("id").primaryKey(), // `${sprintId}:${worklogId}`
    sprintId: text("sprint_id").notNull(),
    issueKey: text("issue_key").notNull(),
    authorAccountId: text("author_account_id"),
    authorName: text("author_name"),
    // Jira's author.active — false for a deactivated account.
    authorActive: boolean("author_active"),
    timeSpentSeconds: real("time_spent_seconds").notNull().default(0),
    started: text("started").notNull(), // ISO timestamp from Jira
    syncedAt: text("synced_at").notNull().default(now()),
  },
  (t) => [
    index("jira_worklogs_sprint_id_idx").on(t.sprintId),
    index("jira_worklogs_author_account_id_idx").on(t.authorAccountId),
  ],
);
