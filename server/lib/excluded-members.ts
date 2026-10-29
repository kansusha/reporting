import { getSetting, putSetting } from "@agent-native/core/settings";

// Team members the user has chosen to leave out of every report (e.g. people
// who sit on the board but aren't part of the team being measured). Stored by
// Jira account id; the display name is kept only so the UI can list and
// restore them without a synced issue to look the name up from.
const EXCLUDED_MEMBERS_SETTING_KEY = "jira-sprint-reporting:excluded-members";

export interface ExcludedMember {
  accountId: string;
  name: string;
}

export async function getExcludedMembers(): Promise<ExcludedMember[]> {
  const stored = await getSetting(EXCLUDED_MEMBERS_SETTING_KEY);
  const members = Array.isArray(stored?.members) ? stored.members : [];
  return members.filter(
    (m): m is ExcludedMember =>
      typeof m?.accountId === "string" && typeof m?.name === "string",
  );
}

export async function putExcludedMembers(
  members: ExcludedMember[],
): Promise<ExcludedMember[]> {
  const byId = new Map(members.map((m) => [m.accountId, m]));
  const next = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  await putSetting(EXCLUDED_MEMBERS_SETTING_KEY, { members: next });
  return next;
}

export async function getExcludedAccountIds(): Promise<Set<string>> {
  return new Set((await getExcludedMembers()).map((m) => m.accountId));
}
