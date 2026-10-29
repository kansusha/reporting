import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { resolveBoard } from "../server/lib/jira.js";
import { computeQuarterlyReport } from "../server/lib/quarterly-report.js";

export default defineAction({
  description:
    "Get quarter-wise reporting for one board (the selected board unless `boardId` is given). Returns committed/completed story points, completion rates, team performance, and logged hours grouped by calendar quarter (Q1–Q4). Includes a quarter-over-quarter comparison between the current and previous quarter.",
  schema: z.object({
    boardId: z
      .string()
      .optional()
      .describe("Configured board id; defaults to the selected board (see get-jira-connection)."),
    quarter: z
      .string()
      .optional()
      .describe('Quarter key to focus on, e.g. "current", "previous", or "2026-Q3". Defaults to "current".'),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ boardId, quarter }) => {
    const board = await resolveBoard(boardId);
    try {
      const data = await computeQuarterlyReport(board.boardId);
      const qStr = (quarter ?? "current").trim().toLowerCase();
      let selectedQuarterData = null;

      if (qStr === "current") {
        selectedQuarterData = data.current;
      } else if (qStr === "previous") {
        selectedQuarterData = data.previous;
      } else {
        // Try exact key "2026-Q3" or short form "q3" / "q3-2026"
        const found = data.quarters.find(
          (q) =>
            q.key.toLowerCase() === qStr ||
            `q${q.quarter}` === qStr ||
            `q${q.quarter}-${q.year}` === qStr,
        );
        if (found) selectedQuarterData = data.byQuarter[found.key] ?? null;
      }

      return { ...data, selectedQuarter: quarter ?? "current", selectedQuarterData };
    } catch {
      fail(
        `No sprint data has been synced yet for "${board.boardName}". Call sync-jira-sprint-data first.`,
        { errorCode: "not_synced" },
      );
    }
  },
});
