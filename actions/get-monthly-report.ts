/**
 * Month-wise tracking and reporting action:
 * Provides ticket counts, story points, status breakdown, team velocity,
 * and filterable tickets grouped strictly by current month and previous month.
 * Any tickets outside current or previous month are strictly excluded.
 */

import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { resolveBoard } from "../server/lib/jira.js";
import { computeMonthlyReport } from "../server/lib/monthly-report.js";

export default defineAction({
  description:
    "Get month-wise tracking and reporting for one board (the selected board unless `boardId` is given). Reports committed/completed story points, completion rates, team performance, logged hours, and ticket lists strictly for the current month and previous month (all other historical or future tickets/points are excluded).",
  schema: z.object({
    boardId: z
      .string()
      .optional()
      .describe("Configured board id; defaults to the selected board (see get-jira-connection)."),
    month: z
      .string()
      .optional()
      .default("all")
      .describe('Filter issues to "all", "current", "previous", or month abbreviation like "jan", "feb", "mar", ..., "dec", or key "YYYY-MM".'),
    assigneeAccountId: z
      .string()
      .optional()
      .describe("Filter results to a specific team member's Jira account ID."),
    assigneeName: z
      .string()
      .optional()
      .describe("Filter results to a specific team member by display name (case-insensitive substring)."),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ boardId, month, assigneeAccountId, assigneeName }) => {
    const board = await resolveBoard(boardId);
    try {
      const data = await computeMonthlyReport(board.boardId);
      const mStr = (month ?? "all").trim().toLowerCase();
      let issues = data.allIssues;
      let selectedMonthData = null;

      if (mStr === "current") {
        issues = data.current.issues;
        selectedMonthData = data.current;
      } else if (mStr === "previous") {
        issues = data.previous.issues;
        selectedMonthData = data.previous;
      } else if (mStr !== "all") {
        const monthData = data.byMonth[mStr] || data.byMonth[month!];
        if (monthData) {
          selectedMonthData = monthData;
          issues = monthData.issues;
        } else {
          const found = data.months.find(
            (m) =>
              m.shortMonthName.toLowerCase() === mStr ||
              m.monthName.toLowerCase() === mStr ||
              m.key.toLowerCase() === mStr ||
              String(m.month) === mStr,
          );
          if (found && data.byMonth[found.key]) {
            selectedMonthData = data.byMonth[found.key];
            issues = data.byMonth[found.key].issues;
          }
        }
      }

      if (assigneeAccountId) {
        issues = issues.filter((i) => i.assigneeAccountId === assigneeAccountId);
      } else if (assigneeName) {
        const lower = assigneeName.toLowerCase();
        issues = issues.filter(
          (i) => i.assigneeName && i.assigneeName.toLowerCase().includes(lower),
        );
      }

      return {
        ...data,
        selectedMonth: month,
        selectedMonthData,
        filteredIssues: issues,
      };
    } catch {
      fail(
        `No sprint data has been synced yet for "${board.boardName}". Call sync-jira-sprint-data first.`,
        { errorCode: "not_synced" },
      );
    }
  },
});
