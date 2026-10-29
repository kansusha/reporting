import { defineAction } from "@agent-native/core/action";
import { desc } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db.js";

export default defineAction({
  description:
    "List synced Jira sprints for every configured board — each board's current sprint plus the one immediately before it (see AGENTS.md scope). Each row has `boardId`/`boardName` and `role` (\"current\" or \"previous\"). Most recently synced first.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => {
    const db = getDb();
    return db
      .select()
      .from(schema.jiraSprints)
      .orderBy(desc(schema.jiraSprints.syncedAt));
  },
});
