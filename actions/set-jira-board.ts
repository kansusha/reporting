import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { getJiraConfig, jiraRequest, putJiraConfig } from "../server/lib/jira.js";

interface JiraBoardResponse {
  id: number;
  name: string;
}

export default defineAction({
  description:
    "Add a Jira board (one board = one team) to the boards this app reports on, and make it the selected board. Several boards can be configured; reports default to the selected one. Also used to switch between already-configured boards. Use list-jira-boards (optionally with `name`) to find the id first.",
  schema: z.object({
    boardId: z.string().min(1).describe("Jira board id from list-jira-boards"),
    select: z
      .boolean()
      .default(true)
      .describe("Make this the selected board (default true). Pass false to add several boards without switching."),
  }),
  run: async ({ boardId, select }) => {
    const config = await getJiraConfig();
    const known = config.boards.find((b) => b.boardId === boardId);
    // Switching between configured boards needs no Jira round trip.
    if (known) {
      return putJiraConfig(select ? { selectedBoardId: boardId } : {});
    }

    const board = await jiraRequest<JiraBoardResponse>(
      `/rest/agile/1.0/board/${encodeURIComponent(boardId)}`,
    ).catch(() => null);
    if (!board) {
      fail(`Board ${boardId} was not found or is not accessible.`, {
        errorCode: "not_found",
      });
    }
    const id = String(board.id);
    return putJiraConfig({
      boards: [...config.boards, { boardId: id, boardName: board.name }],
      selectedBoardId: select || !config.selectedBoardId ? id : config.selectedBoardId,
    });
  },
});
