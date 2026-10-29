// Shared Jira Cloud wiring: credentials, a thin authenticated REST client,
// and the app's Jira board/field configuration.
//
// Auth is a personal Atlassian API token (Basic auth: email + token), not
// OAuth. Jira Software's Agile REST API (boards/sprints — everything this
// app needs) only supports granular OAuth scopes
// (https://developer.atlassian.com/cloud/jira/software/scopes-for-oauth-2-3LO-and-forge-apps/),
// but the framework's shared Jira *workspace connection* OAuth route
// (/_agent-native/connections/oauth/jira/start) can only request classic
// scopes and cannot be overridden by an app — so it structurally cannot
// reach /rest/agile/1.0/*. An API token isn't scope-restricted (it just uses
// the token owner's normal Jira permissions), which is why this app uses one
// instead. See the "Jira Cloud connection" section in AGENTS.md.

import { fail } from "@agent-native/core/action";
import { getSetting, putSetting } from "@agent-native/core/settings";
import { readAppSecret } from "@agent-native/core/secrets";
import { getRequestUserEmail } from "@agent-native/core/server";

const JIRA_CONFIG_SETTING_KEY = "jira-sprint-reporting:config";

export interface JiraBoardRef {
  boardId: string;
  boardName: string;
}

// Several boards (one per team) can be reported on; the UI and actions work
// on one board at a time, defaulting to `selectedBoardId`.
export interface JiraSprintReportingConfig {
  boards: JiraBoardRef[];
  selectedBoardId: string | null;
  // Every story-points-like custom field on the site. Company-managed and
  // team-managed projects populate different ones, and boards of both kinds
  // can be configured side by side, so sync reads whichever is set per issue.
  storyPointsFieldIds: string[] | null;
  // The connected Jira user's time zone; work log days are counted in it,
  // like Timela / worklogDate JQL. Refreshed on every sync.
  timeZone: string | null;
  // Boards whose stored work logs use the current counting rules — a
  // reused previous-sprint snapshot from an older rule set is re-downloaded.
  worklogSchemeByBoard: Record<string, number>;
}

function parseBoards(stored: Record<string, unknown>): JiraBoardRef[] {
  if (Array.isArray(stored.boards)) {
    return stored.boards.filter(
      (b): b is JiraBoardRef =>
        typeof b?.boardId === "string" && typeof b?.boardName === "string",
    );
  }
  // Pre-multi-board config: a single { boardId, boardName }.
  if (typeof stored.boardId === "string") {
    return [
      {
        boardId: stored.boardId,
        boardName: typeof stored.boardName === "string" ? stored.boardName : "",
      },
    ];
  }
  return [];
}

export async function getJiraConfig(): Promise<JiraSprintReportingConfig> {
  const stored = await getSetting(JIRA_CONFIG_SETTING_KEY);
  if (!stored) {
    return {
      boards: [],
      selectedBoardId: null,
      storyPointsFieldIds: null,
      timeZone: null,
      worklogSchemeByBoard: {},
    };
  }
  const boards = parseBoards(stored);
  const selected =
    typeof stored.selectedBoardId === "string" ? stored.selectedBoardId : null;
  return {
    boards,
    selectedBoardId: boards.some((b) => b.boardId === selected)
      ? selected
      : (boards[0]?.boardId ?? null),
    storyPointsFieldIds: Array.isArray(stored.storyPointsFieldIds)
      ? stored.storyPointsFieldIds.filter((f): f is string => typeof f === "string")
      : null,
    timeZone: typeof stored.timeZone === "string" ? stored.timeZone : null,
    worklogSchemeByBoard:
      stored.worklogSchemeByBoard && typeof stored.worklogSchemeByBoard === "object"
        ? (stored.worklogSchemeByBoard as Record<string, number>)
        : {},
  };
}

export async function putJiraConfig(
  patch: Partial<JiraSprintReportingConfig>,
): Promise<JiraSprintReportingConfig> {
  const current = await getJiraConfig();
  const next = { ...current, ...patch };
  await putSetting(JIRA_CONFIG_SETTING_KEY, { ...next });
  return getJiraConfig();
}

// Resolve which configured board an action should work on: an explicit id
// (must be configured) or the selected board.
export async function resolveBoard(boardId?: string): Promise<JiraBoardRef> {
  const config = await getJiraConfig();
  const id = boardId ?? config.selectedBoardId;
  const board = config.boards.find((b) => b.boardId === id);
  if (!board) {
    fail(
      boardId
        ? `Board ${boardId} isn't one of the configured boards. Add it with set-jira-board first.`
        : "No Jira board is configured yet. Use list-jira-boards then set-jira-board first.",
      { errorCode: "not_configured" },
    );
  }
  return board;
}

interface JiraCredentials {
  baseUrl: string;
  email: string;
  apiToken: string;
}

async function readJiraCredentials(): Promise<JiraCredentials | null> {
  const email = getRequestUserEmail();
  if (!email) return null;

  const [baseUrl, accountEmail, apiToken] = await Promise.all([
    readAppSecret({ key: "JIRA_BASE_URL", scope: "user", scopeId: email }),
    readAppSecret({ key: "JIRA_USER_EMAIL", scope: "user", scopeId: email }),
    readAppSecret({ key: "JIRA_API_TOKEN", scope: "user", scopeId: email }),
  ]);
  if (!baseUrl || !accountEmail || !apiToken) return null;

  return {
    baseUrl: baseUrl.value.trim().replace(/\/+$/, ""),
    email: accountEmail.value.trim(),
    apiToken: apiToken.value,
  };
}

export interface JiraConnectionStatus {
  connected: boolean;
  siteLabel: string | null;
}

export async function getJiraConnectionStatus(): Promise<JiraConnectionStatus> {
  const creds = await readJiraCredentials();
  return {
    connected: Boolean(creds),
    siteLabel: creds?.baseUrl ?? null,
  };
}

interface JiraRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Record<string, unknown>;
}

export async function jiraRequest<T = unknown>(
  path: string,
  options: JiraRequestOptions = {},
): Promise<T> {
  const creds = await readJiraCredentials();
  if (!creds) {
    fail(
      "Jira is not connected. Add your Jira site URL, account email, and API token in Settings → API keys.",
      { errorCode: "not_connected" },
    );
  }

  const url = new URL(path, creds.baseUrl);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }

  const auth = Buffer.from(`${creds.email}:${creds.apiToken}`).toString(
    "base64",
  );
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    fail(
      `Jira request failed: ${options.method ?? "GET"} ${path} → ${response.status} ${response.statusText}${detail ? ` — ${detail.slice(0, 500)}` : ""}`,
      { errorCode: "jira_request_failed", statusCode: response.status },
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// The connected user's Jira time zone (what worklogDate JQL and Timela use
// for day boundaries). Falls back to the last known value, then UTC.
export async function resolveJiraTimeZone(): Promise<string> {
  const me = await jiraRequest<{ timeZone?: string }>("/rest/api/3/myself").catch(
    () => null,
  );
  const config = await getJiraConfig();
  const timeZone = me?.timeZone || config.timeZone || "UTC";
  if (timeZone !== config.timeZone) await putJiraConfig({ timeZone });
  return timeZone;
}

interface JiraFieldsResponse {
  id: string;
  name: string;
}

let storyPointsFieldPromise: Promise<string[]> | null = null;

// Call when the cached field ids should be re-discovered so a stale
// in-flight/resolved discovery from this process doesn't shadow the fresh
// settings-store value.
export function resetStoryPointsFieldCache(): void {
  storyPointsFieldPromise = null;
}

// Jira's story-points field is a site-specific custom field id (e.g.
// customfield_10016). A site commonly has BOTH "Story point estimate" (what
// team-managed ["simple" board type] projects populate) and "Story Points"
// (what company-managed projects populate). With several boards configured,
// both kinds can be in play at once, so discover every candidate once from
// /rest/api/3/field, cache the ids in app settings, and let sync read the
// first one that's set on each issue — "Story point estimate" first, since
// team-managed is Jira Cloud's default project type.
export async function resolveStoryPointsFieldIds(): Promise<string[]> {
  const config = await getJiraConfig();
  if (config.storyPointsFieldIds) return config.storyPointsFieldIds;

  if (!storyPointsFieldPromise) {
    storyPointsFieldPromise = (async () => {
      const fields = await jiraRequest<JiraFieldsResponse[]>("/rest/api/3/field");
      const rank = (name: string) =>
        name === "Story point estimate" ? 0 : name === "Story Points" ? 1 : 2;
      const ids = fields
        .filter((field) => /story point/i.test(field.name))
        .sort((a, b) => rank(a.name) - rank(b.name))
        .map((field) => field.id);
      await putJiraConfig({ storyPointsFieldIds: ids });
      return ids;
    })().catch((err) => {
      storyPointsFieldPromise = null;
      throw err;
    });
  }
  return storyPointsFieldPromise;
}
