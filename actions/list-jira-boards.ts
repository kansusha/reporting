import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { jiraRequest } from "../server/lib/jira.js";

interface JiraBoardsResponse {
  values: { id: number; name: string; type: string }[];
  isLast: boolean;
}

// Safety cap on pagination; a site with more boards than this should search
// by name instead.
const MAX_BOARDS = 1000;

export default defineAction({
  description:
    "List boards visible to the connected Jira Cloud account, so the user can pick boards to report on (set-jira-board). Pass `name` to search (case-insensitive substring, done by Jira). Includes all board types — team-managed ('simple') Jira Software projects report sprints under board type \"simple\", not \"scrum\", even though they have real sprints.",
  schema: z.object({
    name: z.string().optional().describe("Filter boards whose name contains this text."),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ name }) => {
    const boards: { id: string; name: string; type: string }[] = [];
    let startAt = 0;
    for (;;) {
      const page = await jiraRequest<JiraBoardsResponse>("/rest/agile/1.0/board", {
        query: { startAt, maxResults: 50, name: name?.trim() || undefined },
      });
      boards.push(
        ...page.values.map((board) => ({
          id: String(board.id),
          name: board.name,
          type: board.type,
        })),
      );
      startAt += page.values.length;
      if (page.isLast || page.values.length === 0 || boards.length >= MAX_BOARDS) break;
    }
    return boards.sort((a, b) => a.name.localeCompare(b.name));
  },
});
