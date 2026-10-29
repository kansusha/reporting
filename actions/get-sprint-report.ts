/**
 * The core sprint report: totals, status breakdown, per-assignee ("team")
 * breakdown, story points, and carry-forward tickets — for the board's
 * current sprint only. Reads the local cache populated by
 * sync-jira-sprint-data — call that first if data may be stale.
 */

import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { resolveBoard } from "../server/lib/jira.js";
import { getSprintReportByRole } from "../server/lib/sprint-report.js";

export default defineAction({
  description:
    "Get the sprint report for one board's current sprint only (the selected board unless `boardId` is given): committed/completed story points, status breakdown, per-assignee team breakdown, carry-forward tickets, and work log (hours logged during the sprint by member, by ticket, and per entry). Call sync-jira-sprint-data first if the data might be stale. Use get-sprint-comparison instead when the user wants this alongside the previous sprint.",
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
    const report = await getSprintReportByRole("current", board.boardId);
    if (!report) {
      fail(
        `No sprint has been synced yet for "${board.boardName}". Call sync-jira-sprint-data first.`,
        { errorCode: "not_synced" },
      );
    }
    return report;
  },
});
