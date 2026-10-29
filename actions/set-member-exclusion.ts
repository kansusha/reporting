/**
 * Exclude team members from (or restore them to) every sprint report.
 * Members can be named by Jira account id or by display name; names are
 * resolved against assignees in the synced sprints. A name that matches no
 * one, or more than one person, is reported back rather than guessed.
 */

import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { getDb, schema } from "../server/db.js";
import {
  getExcludedMembers,
  putExcludedMembers,
  type ExcludedMember,
} from "../server/lib/excluded-members.js";

function normalize(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export default defineAction({
  description:
    "Exclude team members from every sprint report, or restore them (excluded: false). Identify members by Jira account id and/or display name; names are matched case-insensitively against assignees in the synced sprints (exact match first, then a unique partial match). Returns the updated excluded list plus any names that were not found or were ambiguous — report those to the user instead of guessing.",
  schema: z.object({
    names: z
      .array(z.string().min(1))
      .optional()
      .describe("Assignee display names, as shown in the Team performance table."),
    accountIds: z
      .array(z.string().min(1))
      .optional()
      .describe("Jira account ids."),
    excluded: z
      .boolean()
      .default(true)
      .describe("true to exclude from reports, false to restore."),
  }),
  run: async ({ names = [], accountIds = [], excluded }) => {
    if (names.length === 0 && accountIds.length === 0) {
      fail("Pass at least one name or account id.", { errorCode: "invalid_input" });
    }

    const current = await getExcludedMembers();
    const db = getDb();
    const rows = await db
      .select({
        accountId: schema.jiraIssues.assigneeAccountId,
        name: schema.jiraIssues.assigneeName,
      })
      .from(schema.jiraIssues);
    const known = new Map<string, string>();
    for (const r of rows) if (r.accountId) known.set(r.accountId, r.name ?? r.accountId);
    // Restoring should also resolve people who are only in the excluded list.
    for (const m of current) if (!known.has(m.accountId)) known.set(m.accountId, m.name);
    const people = [...known].map(([accountId, name]) => ({ accountId, name }));

    const matched: ExcludedMember[] = [];
    const notFound: string[] = [];
    const ambiguous: { name: string; candidates: string[] }[] = [];

    for (const raw of names) {
      const q = normalize(raw);
      let hits = people.filter((p) => normalize(p.name) === q);
      if (hits.length === 0) hits = people.filter((p) => normalize(p.name).includes(q));
      if (hits.length === 1) matched.push(hits[0]);
      else if (hits.length === 0) notFound.push(raw);
      else ambiguous.push({ name: raw, candidates: hits.map((h) => h.name) });
    }
    for (const id of accountIds) {
      matched.push({ accountId: id, name: known.get(id) ?? id });
    }

    const matchedIds = new Set(matched.map((m) => m.accountId));
    const members = await putExcludedMembers(
      excluded
        ? [...current, ...matched]
        : current.filter((m) => !matchedIds.has(m.accountId)),
    );

    return {
      members,
      changed: matched.map((m) => m.name),
      notFound,
      ambiguous,
    };
  },
});
