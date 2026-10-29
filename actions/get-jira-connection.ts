import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getJiraConfig, getJiraConnectionStatus } from "../server/lib/jira.js";

export default defineAction({
  description:
    "Check whether Jira Cloud is connected, which boards this app reports on (`boards`), and which one is selected (`board`, null if none). Call this before sync-jira-sprint-data or get-sprint-report if connection state is unknown.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => {
    const [status, config] = await Promise.all([
      getJiraConnectionStatus(),
      getJiraConfig(),
    ]);
    return {
      ...status,
      boards: config.boards,
      selectedBoardId: config.selectedBoardId,
      board: config.boards.find((b) => b.boardId === config.selectedBoardId) ?? null,
    };
  },
});
