import { defineAction, fail } from "@agent-native/core/action";
import { eq, inArray } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db.js";
import { getJiraConfig, putJiraConfig } from "../server/lib/jira.js";

export default defineAction({
  description:
    "Stop reporting on a configured Jira board and delete its synced sprints/issues/work logs from the local cache. Nothing is changed in Jira.",
  schema: z.object({
    boardId: z.string().min(1).describe("Configured board id (see get-jira-connection)."),
  }),
  run: async ({ boardId }) => {
    const config = await getJiraConfig();
    if (!config.boards.some((b) => b.boardId === boardId)) {
      fail(`Board ${boardId} isn't configured.`, { errorCode: "not_found" });
    }

    const db = getDb();
    await db.transaction(async (tx) => {
      const sprintRows = await tx
        .select({ id: schema.jiraSprints.id })
        .from(schema.jiraSprints)
        .where(eq(schema.jiraSprints.boardId, boardId));
      const ids = sprintRows.map((r) => r.id);
      if (ids.length > 0) {
        await tx.delete(schema.jiraIssues).where(inArray(schema.jiraIssues.sprintId, ids));
        await tx.delete(schema.jiraWorklogs).where(inArray(schema.jiraWorklogs.sprintId, ids));
        await tx.delete(schema.jiraSprints).where(inArray(schema.jiraSprints.id, ids));
      }
    });

    const boards = config.boards.filter((b) => b.boardId !== boardId);
    return putJiraConfig({
      boards,
      selectedBoardId:
        config.selectedBoardId === boardId
          ? (boards[0]?.boardId ?? null)
          : config.selectedBoardId,
    });
  },
});
