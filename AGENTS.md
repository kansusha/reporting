# App — Agent Guide

Sprintline is a sprint reporting workbench for Jira Cloud: one or more
configured boards (each board = one team), viewed one board at a time,
reporting each board's current sprint by ticket, status, assignee, and story
points. See `DEVELOPING.md` before making any
source code change.

## Skills

The default app skill surface is intentionally small. Promotion, learning,
translation, changelog, provider, and release workflows are optional; enable
the matching skill only when this app actually uses that workflow. The
`docs-search` action reads the version-matched framework docs bundled with
  `@agent-native/core`; `source-search` reads core and first-party template
  implementations. Prefer both over memory when package APIs, actions, or agent
  surfaces are involved.

This repo is a single standalone app (`agent-native.scaffold.shape:
"standalone"`), not a workspace root. If the user asks for a workspace, a
platform or suite of apps, a second app, an app shell or launcher, or Dispatch,
read the `multi-app-workspace` skill before touching the repo layout.

## Core Rules

- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- Follow the root framework contract: data in SQL, actions first, application
  state for navigation/selection, and shared agent chat for AI work.
- Store large file/blob payloads in configured file/blob storage, not SQL: no
  base64, `data:` URLs, images, video/audio, PDFs, ZIPs, screenshots,
  thumbnails, or replay chunks in app tables, `application_state`, `settings`,
  or `resources`; persist URLs, ids, or handles instead.
- Never hardcode API keys, tokens, webhook URLs, signing secrets, private
  Builder/internal data, customer data, or credential-looking literals. Use
  secrets/OAuth/runtime configuration and obvious placeholders in examples.
- For external integrations, inspect the workspace/provider connection catalog
  first. Reuse an existing connection and its scoped credential resolver; only
  use app-local vault/OAuth/settings primitives when no reusable connection
  exists. Keep custom setup UI provider-specific and never duplicate storage.
- Keep actions deterministic and focused. Research, analysis, generation,
  recommendation, and synthesis start in the AgentSidebar and let the agent
  orchestrate its tools; follow-ups stay in the same thread rather than moving
  the user to a second freeform prompt box.
- Never fabricate. If an action fails or data is missing, say so and recover
  instead of inventing a result or claiming success.
- Verify a write before reporting it done — re-read the row or the screen.
- Use `view-screen` or application state when the active page/selection is
  unclear.

For a custom app, keep `server/plugins/config.ts` aligned with the product
brand. Its `app.name` is used in transactional emails, and its optional
`app.logoUrl` can point to an absolute HTTPS logo URL.

## Jira Cloud connection

Auth is a **personal Atlassian API token** (Basic auth: email + token), not
OAuth. This was a deliberate correction, not the original design: the
framework's shared Jira *workspace connection* OAuth route
(`/_agent-native/connections/oauth/jira/start`) only ever requests classic
scopes (`read:jira-work`, `read:jira-user`, `offline_access`) and cannot be
overridden by an app. Per Atlassian's own docs, **Jira Software's Agile REST
API (`/rest/agile/1.0/*` — boards, sprints, sprint issues; everything this
app needs) doesn't support classic scopes at all**, only granular ones
(`read:board-scope:jira-software`, `read:sprint:jira-software`, ...). So the
shared OAuth route structurally cannot reach the data this app reports on —
it connects fine and then every board/sprint call 401s with `"Unauthorized;
scope does not match"`. Do not re-wire this app back onto that route; do not
add `registerRequiredSecret({ kind: "oauth" })` for Jira either, for the same
reason. See `server/lib/jira.ts` for the full explanation.

An API token isn't scope-restricted — it just uses the token owner's normal
Jira permissions — so it reaches both platform and Agile endpoints. Three
secrets are registered (`server/plugins/register-secrets.ts`, `scope: "user"`,
so each user connects their own Jira account) and read via `readAppSecret` in
`server/lib/jira.ts`, not env vars:

| Secret | What it is |
| --- | --- |
| `JIRA_BASE_URL` | The Jira Cloud site, e.g. `https://yourteam.atlassian.net` |
| `JIRA_USER_EMAIL` | The Atlassian account email that owns the token |
| `JIRA_API_TOKEN` | Created at https://id.atlassian.com/manage-profile/security/api-tokens |

Users set these from Settings → API keys (`buildSettingsRoute("api-keys")`,
the `JIRA_SETTINGS_URL` constant in `app/routes/_index.tsx`); `get-jira-connection`
reports whether all three are present.

Boards: **several boards can be configured, each board = one team**, and
every report works on one board at a time. The config
(`jira-sprint-reporting:config` in the settings store, `server/lib/jira.ts`)
holds `boards` + `selectedBoardId`; a legacy single `{ boardId, boardName }`
config is read as a one-board list. Every report/sync action takes an
optional `boardId` and defaults to the selected board (`resolveBoard`). When
the user names a board ("CMG - New Initiatives"), find its id with
`list-jira-boards { name }`; never mix numbers across boards unless asked.

Sprint scope per board is **current + the sprint immediately before it**, no
further history — `jira_sprints.role` is `"current"` or `"previous"` (exactly
one row each per board). `sync-jira-sprint-data` syncs one board, replacing
only that board's rows (plus rows of boards no longer configured). Sprint row
ids are board-scoped (`${boardId}:${jiraSprintId}`) because one Jira sprint
can appear on several boards whose filters overlap; `jira_issues.sprintId`
holds that row id and issues are keyed `(sprintId, key)`.

Picking the current/previous sprint: a board's sprint list includes sprints
owned by other boards, so sync prefers sprints whose `originBoardId` is this
board (falling back to all listed). Among those, current = the most recently
started active sprint (else the latest closed), previous = the latest closed.
Closed sprints are paged in full — Jira lists them oldest first. For speed,
sync fetches both sprints in parallel (issue pages in parallel too), and
**reuses the previous sprint's stored snapshot** when it was taken after that
sprint closed (same `completeDate`) — pass `full: true` to force a
re-download. The result includes `timingsMs` (findSprints / issues / worklogs
/ write) for diagnosing slow syncs. Story points
are read from every "story point"-named field (`storyPointsFieldIds`,
"Story point estimate" first), since company- and team-managed boards fill
different fields.

`list-jira-boards` lists **all** board types, not just `type: "scrum"` — a
team-managed ("next-gen") Jira Software project reports its board as
`type: "simple"` via the Agile REST API even when it has real sprints. An
earlier version filtered to `type: "scrum"` and silently hid every
team-managed board (most boards on a typical site) from the picker.

Every report only counts **active, assigned** work: an issue is excluded when
it's unassigned or `assigneeActive === false` (a deactivated/offboarded
Atlassian account — captured from Jira's `assignee.active` in
`sync-jira-sprint-data`). The rule lives in `isReportableIssue`
(`server/lib/sprint-report.ts`) and applies everywhere — sprint totals
(committed/completed points, counts), status breakdown, team performance,
carry-forward, `list-sprint-issues`, and the CSV export. The same function
also drops members the user has **excluded** (`set-member-exclusion`): a list
of Jira account ids + display names kept in the settings store
(`server/lib/excluded-members.ts`), never hardcoded in source. When the user
asks to remove/hide/exclude people by name, call `set-member-exclusion` with
their names and report back any `notFound` / `ambiguous` names rather than
guessing (display names can differ slightly from what the user typed). The raw rows are still
synced into `jira_issues`; only reporting filters them. `assigneeActive` is
`null` for rows synced before that column existed; treated as active rather
than hiding everything until the next sync.

Work log is counted **like a Timela timesheet** (the team logs time with the
Timela Jira app, which stores entries as native Jira worklogs — there is no
separate Timela API to call). For each synced sprint, `sync-jira-sprint-data`
runs `project in (<board's projects>) AND worklogDate >= from AND
worklogDate <= to` and stores every matching worklog in `jira_worklogs` —
**including tickets outside the sprint**. The window
(`server/lib/worklog-window.ts`) is whole calendar days in the Jira user's
time zone (`/rest/api/3/myself`, cached as `timeZone` in config): sprint start
day → planned end day (or completion day if it closed late; an active sprint
past its end runs to today). Hours are attributed to the worklog **author**;
only the author side is filtered (`reportableWorklogs`: deactivated authors
and excluded members are left out). Reports expose `totals.loggedHours` /
`worklogEntryCount`, `team[].loggedHours`, and `workLog.{window, byMember,
byIssue, entries}` (`inSprint` marks tickets that aren't in the sprint). If a
user says numbers don't match Timela, first compare the date range, time
zone, projects, and member filter they used in Timela against
`workLog.window`. `WORKLOG_SCHEME` in the sync action is bumped when these
rules change so a reused previous-sprint snapshot is re-downloaded.

Ticket filters (Ticket details tab): **To Do / In Progress / Completed /
Deployed**, from `statusBucket()` in `server/lib/sprint-report.ts`.
"Deployed" is a workflow status name, matched case-insensitively on
"deploy", and wins over the Jira status category; Completed = other Done
statuses, In Progress = other In Progress statuses, To Do = the rest. Reports
carry `statusBuckets` counts; `list-sprint-issues { bucket }` returns the
matching tickets.

## Action Table

| Action | What it does |
| --- | --- |
| `get-jira-connection` (GET) | Connection status, configured `boards`, `selectedBoardId`, and the selected `board`. Call first if connection state is unknown. |
| `list-jira-boards` (GET) | All boards visible to the connected account (paged in full), optional `name` search, for `set-jira-board`. |
| `set-jira-board` | Add a board to the configured list and select it (`select: false` adds without switching); also switches between configured boards. |
| `remove-jira-board` | Stop reporting on a board and delete its synced rows (Jira is untouched). |
| `sync-jira-sprint-data` | Pull one board's (`boardId`, default selected) current sprint plus the one before it, and their issues, into the local cache. Call per board before reading a report if data may be stale. |
| `list-sprints` (GET) | List synced sprints for all boards — up to 2 rows per board, each with `boardId`, `boardName`, `role: "current" \| "previous"`. |
| `get-sprint-report` (GET) | One board's current sprint report: totals (incl. logged hours), status breakdown, per-assignee ("team") breakdown, carry-forward tickets, `workLog`. Optional `boardId`. |
| `get-sprint-comparison` (GET) | `{ current, previous }` for one board (optional `boardId`) — same report shape as `get-sprint-report` (`previous` is `null` until a second sprint has been synced). Powers the Team performance comparison chart, member-wise table, and per-person deltas. |
| `list-sprint-issues` (GET) | Filterable ticket list for one board's current sprint (`boardId`, `bucket`, `statusCategory`, `assigneeAccountId`); each ticket has `bucket` and `loggedHours`. |
| `list-excluded-members` (GET) | Members excluded from every report (account id + name). |
| `set-member-exclusion` | Exclude (`excluded: true`, default) or restore (`false`) members by `names` and/or `accountIds`. Returns the updated list plus `notFound` / `ambiguous` names. |
| `export-sprint-report` (GET) | One board's (optional `boardId`) CSV text (summary, per-ticket rows with logged hours, work log by member, work log entries) + filename; UI triggers the download. |
| `get-monthly-report` (GET) | Month-wise tracking report for one board (optional `boardId`, `month: "all" \| "current" \| "previous"`): committed/completed points, completion rates, MoM deltas, status buckets, team velocity, and tickets strictly for the current month and previous month (historical/older and future tickets are excluded). |
| `export-monthly-report` (GET) | Export one board's month-wise tracking report (strictly current and previous month tickets and story points) as CSV text + filename; UI triggers the download. |
| `jira-api-request` (GET) | Generic Jira REST escape hatch (any GET endpoint/JQL) for analysis the canned report actions don't cover. Prefer the actions above for the standard report. |

Recurring reports are **not** a custom scheduler in this app — they go through
the shared Automations page (Settings → Automations / `manage-automation`):
define a scheduled automation whose prompt runs `sync-jira-sprint-data` then
`get-sprint-report` for each board it covers (pass `boardId`) and delivers the
result. The in-app Automation tab is a
status view + deep link into that shared page, not its own scheduling store.

## Application State

- `navigation` describes the current view and selected entity ids (route-based;
  this app is a single route, so it stays at `home`/`/`).
- `sprint-reporting-screen` carries the finer-grained UI state `navigation`
  can't express here: `{ page: "reports" | "automation", view: ReportView, boardId, boardName }`
  (`boardId`/`boardName` = the board on screen; `view` includes `"monthly"`) — written by
  `app/routes/_index.tsx` and returned by `view-screen`. Default report calls
  to that `boardId` when the user says "this board".
- `sprint-reporting-ticket-filter` = `{ filter: "all" | StatusBucket }`, the
  Ticket details filter on screen (also returned by `view-screen` as
  `ticketFilter`).
- `sprint-reporting-monthly-filter` = `{ month: "all" | "current" | "previous" | string, member?: string, bucket?: string, search?: string }`, the
  Monthly tracking filter on screen (also returned by `view-screen` as `monthlyFilter`).
- `sprint-reporting-team-filter` = `{ period: "sprint" | "mom" | "current" | "previous" | string, member?: string, search?: string }`, the
  Team performance filter on screen (also returned by `view-screen` as `teamFilter`).
- `navigate` moves the UI when the app supports it.
- `view-screen` is the first tool to call when the user's visible context
  matters — it returns `navigation`, `sprint-reporting-screen`, `ticketFilter`, `monthlyFilter`, and `teamFilter`.

## Source Changes

Before building common workspace or agent UI, read `agent-native-toolkit`; read
`customizing-agent-native` before adapting shared UI.

- Guarded verification: run `pnpm agent-native:doctor`; fix findings before done.
