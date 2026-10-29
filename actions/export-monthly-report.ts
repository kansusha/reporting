import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { resolveBoard } from "../server/lib/jira.js";
import { computeMonthlyReport } from "../server/lib/monthly-report.js";

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

export default defineAction({
  description:
    "Export one board's month-wise tracking report (strictly current and previous month tickets and story points) as CSV text. Returns filename and csv string.",
  schema: z.object({
    boardId: z
      .string()
      .optional()
      .describe("Configured board id; defaults to the selected board."),
    month: z
      .string()
      .optional()
      .default("all")
      .describe("Optional month filter (e.g. 'all', 'jan', 'feb', 'sep', 'oct', 'current', 'previous')."),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ boardId, month }) => {
    const board = await resolveBoard(boardId);
    let data;
    try {
      data = await computeMonthlyReport(board.boardId);
    } catch {
      fail(`No sprint data has been synced yet for "${board.boardName}". Call sync-jira-sprint-data first.`, {
        errorCode: "not_synced",
      });
    }

    const { current, previous, comparison, allIssues, months, byMonth } = data;
    const mStr = (month ?? "all").trim().toLowerCase();

    let exportIssues = allIssues;
    let label = "All Months";

    if (mStr === "current") {
      exportIssues = current.issues;
      label = current.meta.label;
    } else if (mStr === "previous") {
      exportIssues = previous.issues;
      label = previous.meta.label;
    } else if (mStr !== "all") {
      const monthData = byMonth[mStr] || byMonth[month!];
      if (monthData) {
        exportIssues = monthData.issues;
        label = monthData.meta.label;
      } else {
        const found = months.find((m) => m.shortMonthName.toLowerCase() === mStr || m.key === mStr);
        if (found && byMonth[found.key]) {
          exportIssues = byMonth[found.key].issues;
          label = found.label;
        }
      }
    }

    const summary = toCsv([
      ["Board", board.boardName],
      ["Period", label],
      [],
      ["Metric", `${previous.meta.label} (Previous)`, `${current.meta.label} (Current)`, "Delta"],
      ["Completed Story Points", previous.totals.completedPoints, current.totals.completedPoints, comparison.completedPointsDelta],
      ["Committed Story Points", previous.totals.committedPoints, current.totals.committedPoints, comparison.committedPointsDelta],
      ["Completion Rate (%)", `${previous.totals.completionPct}%`, `${current.totals.completionPct}%`, `${Math.round((current.totals.completionPct - previous.totals.completionPct) * 10) / 10}%`],
      ["Done Tickets", previous.totals.doneCount, current.totals.doneCount, comparison.doneCountDelta],
      ["Total Tickets", previous.totals.issueCount, current.totals.issueCount, comparison.issueCountDelta],
      ["Logged Hours", previous.totals.loggedHours, current.totals.loggedHours, comparison.loggedHoursDelta],
    ]);

    const tickets = toCsv([
      ["Key", "Summary", "Type", "Status", "Bucket", "Story Points", "Assignee", "Month", "Created", "Resolved", "Logged Hours"],
      ...exportIssues.map((i) => [
        i.key,
        i.summary,
        i.issueType,
        i.status,
        i.bucket,
        i.storyPoints ?? "",
        i.assigneeName ?? "Unassigned",
        i.monthRole === "current" ? current.meta.label : previous.meta.label,
        i.createdAt ?? "",
        i.resolvedAt ?? "",
        i.loggedHours,
      ]),
    ]);

    const team = toCsv([
      ["Team Member", "Month", "Completed Points", "Committed Points", "Done Tickets", "Total Tickets", "Logged Hours"],
      ...previous.team.map((m) => [m.assigneeName, previous.meta.label, m.completedPoints, m.committedPoints, m.doneCount, m.totalCount, m.loggedHours]),
      ...current.team.map((m) => [m.assigneeName, current.meta.label, m.completedPoints, m.committedPoints, m.doneCount, m.totalCount, m.loggedHours]),
    ]);

    const csv = `${summary}\n\n${tickets}\n\n${team}\n`;
    const safeBoard = board.boardName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const filename = `${safeBoard || "board"}-monthly-tracking-${current.meta.key}.csv`;

    return { filename, csv };
  },
});
