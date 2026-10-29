import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { resolveBoard } from "../server/lib/jira.js";
import {
  computeSprintReport,
  getSprintByRole,
  isReportableIssue,
  loadSprintData,
} from "../server/lib/sprint-report.js";

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: (string | number)[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

export default defineAction({
  description:
    "Export one board's current sprint report (the selected board unless `boardId` is given) as CSV text (summary, per-ticket rows with logged hours, work log by member, and work log entries). Returns the CSV content and a suggested filename; the UI triggers the file download.",
  schema: z.object({
    boardId: z
      .string()
      .optional()
      .describe("Configured board id; defaults to the selected board (see get-jira-connection)."),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ boardId }) => {
    const board = await resolveBoard(boardId);
    const sprint = await getSprintByRole("current", board.boardId);
    if (!sprint) {
      fail(
        `No sprint has been synced yet for "${board.boardName}". Call sync-jira-sprint-data first.`,
        { errorCode: "not_synced" },
      );
    }

    const { issues, worklogs, excludedAccountIds, worklogWindow } = await loadSprintData(sprint);
    const report = computeSprintReport(
      sprint,
      issues,
      excludedAccountIds,
      worklogs,
      worklogWindow,
    );
    const loggedByIssue = new Map(
      report.workLog.byIssue.map((row) => [row.key, row.loggedHours]),
    );

    const summary = toCsv([
      [
        "Board",
        "Sprint",
        "Committed points",
        "Completed points",
        "In progress tickets",
        "To Do tickets",
        "Carry-forward tickets",
        "Logged hours",
        "Work log from",
        "Work log to",
        "Time zone",
      ],
      [
        board.boardName,
        report.sprint.name,
        report.totals.committedPoints,
        report.totals.completedPoints,
        report.totals.inProgressCount,
        report.totals.todoCount,
        report.totals.carryForwardCount,
        report.totals.loggedHours,
        worklogWindow?.from ?? "",
        worklogWindow?.to ?? "",
        worklogWindow?.timeZone ?? "",
      ],
    ]);

    const tickets = toCsv([
      ["Key", "Summary", "Status", "Assignee", "Story points", "Logged hours"],
      ...issues
        .filter((i) => isReportableIssue(i, excludedAccountIds))
        .map((issue) => [
          issue.key,
          issue.summary,
          issue.status,
          issue.assigneeName ?? "Unassigned",
          issue.storyPoints ?? "",
          loggedByIssue.get(issue.key) ?? 0,
        ]),
    ]);

    const workLogByMember = toCsv([
      ["Team member", "Logged hours", "Work log entries"],
      ...report.workLog.byMember.map((m) => [m.name, m.loggedHours, m.entryCount]),
    ]);

    const workLogEntries = toCsv([
      ["Started", "Team member", "Key", "Summary", "In sprint", "Hours"],
      ...report.workLog.entries.map((e) => [
        e.started,
        e.authorName,
        e.issueKey,
        e.summary,
        e.inSprint ? "Yes" : "No",
        e.hours,
      ]),
    ]);

    const csv = `${summary}\n\n${tickets}\n\n${workLogByMember}\n\n${workLogEntries}\n`;
    const safeName = `${board.boardName} ${report.sprint.name}`.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

    return {
      filename: `${safeName || "sprint"}-report.csv`,
      csv,
    };
  },
});
