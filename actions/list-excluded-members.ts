import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getExcludedMembers } from "../server/lib/excluded-members.js";

export default defineAction({
  description:
    "List team members excluded from every sprint report (totals, team performance, comparison, ticket list, CSV export). Use set-member-exclusion to change it.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => ({ members: await getExcludedMembers() }),
});
