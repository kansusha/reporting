import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { jiraRequest } from "../server/lib/jira.js";

export default defineAction({
  description:
    'Call any Jira Cloud REST API GET endpoint for analysis beyond the canned sprint-report actions — e.g. custom JQL via "/rest/api/3/search/jql", other boards via "/rest/agile/1.0/board", or fields the report doesn\'t surface. Prefer get-sprint-report / list-sprint-issues for the standard report. Requires Jira to be connected (see get-jira-connection).',
  schema: z.object({
    path: z
      .string()
      .min(1)
      .describe('Jira REST path, e.g. "/rest/agile/1.0/board" or "/rest/api/3/search/jql"'),
    query: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Optional query parameters."),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ path, query }) => jiraRequest(path, { query }),
});
