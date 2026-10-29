/**
 * The current sprint's report alongside the previous sprint's, for
 * comparison views (team performance vs last sprint, trend charts). Reads
 * the local cache populated by sync-jira-sprint-data.
 */

import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { resolveBoard } from "../server/lib/jira.js";
import { getSprintReportByRole } from "../server/lib/sprint-report.js";

export default defineAction({
  description:
    "Get one board's current sprint report together with its previous sprint's (the selected board unless `boardId` is given), for comparison (team performance vs last sprint, previous-sprint detail charts). `previous` is null when no earlier sprint has been synced yet (e.g. the very first sprint on a board). Call sync-jira-sprint-data first if the data might be stale.",
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
    const [current, previous] = await Promise.all([
      getSprintReportByRole("current", board.boardId),
      getSprintReportByRole("previous", board.boardId),
    ]);
    if (!current) {
      fail(
        `No sprint has been synced yet for "${board.boardName}". Call sync-jira-sprint-data first.`,
        { errorCode: "not_synced" },
      );
    }
    return { current, previous };
  },
});
