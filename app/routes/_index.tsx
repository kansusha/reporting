import { useEffect, useMemo, useState } from "react";

import {
  readClientAppState,
  writeClientAppState,
} from "@agent-native/core/client/application-state";
import {
  actionErrorMessage,
  callAction,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { buildSettingsRoute } from "@agent-native/core/client/navigation";
import { signOut } from "@agent-native/core/client/sign-out";
import { useSession } from "@agent-native/core/client/use-session";

import { APP_TITLE } from "@/lib/app-config";
import { MonthlyTrackingSection } from "@/components/MonthlyTrackingSection";
import { QuarterlyTrackingSection } from "@/components/QuarterlyTrackingSection";
import { OverviewSection } from "@/components/OverviewSection";
import { StoryPointsSection } from "@/components/StoryPointsSection";
import type { MonthlyReportData } from "@/lib/monthly-report-types";

// Jira auth is a personal API token (Settings → API keys), not OAuth — see
// server/lib/jira.ts for why.
const JIRA_SETTINGS_URL = buildSettingsRoute("api-keys");

type Page = "reports" | "automation";
type ReportView =
  | "overview"
  | "tickets"
  | "team"
  | "work-log"
  | "points"
  | "carry-forward"
  | "monthly"
  | "quarterly";

const reportViews: { id: ReportView; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "monthly", label: "Monthly tracking" },
  { id: "quarterly", label: "Quarterly tracking" },
  { id: "tickets", label: "Ticket details" },
  { id: "team", label: "Team performance" },
  { id: "work-log", label: "Work log" },
  { id: "points", label: "Story points" },
  { id: "carry-forward", label: "Carry-forward" },
];

function triggerCsvDownload(filename: string, csv: string) {
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function BrandMark() {
  return (
    <div className="flex items-center gap-2.5 px-5 py-5">
      <div className="brand-mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <span className="text-[15px] font-semibold tracking-[-0.04em] text-foreground">
        Sprintline
      </span>
    </div>
  );
}

function LogoutButton({ className = "" }: { className?: string }) {
  const [signingOut, setSigningOut] = useState(false);
  return (
    <button
      type="button"
      className={`secondary-button ${className}`}
      disabled={signingOut}
      onClick={() => {
        setSigningOut(true);
        void signOut();
      }}
    >
      {signingOut ? "Signing out…" : "Log out"}
    </button>
  );
}

function AccountRow() {
  const { session } = useSession();
  return (
    <div className="mt-3 flex items-center justify-between gap-2 border-t border-sidebar-border px-1 pt-3">
      <div className="min-w-0">
        <div className="text-[10px] text-muted-foreground">Signed in as</div>
        <div
          className="truncate text-[11px] font-medium text-foreground"
          title={session?.email}
        >
          {session?.email ?? "—"}
        </div>
      </div>
      <LogoutButton className="shrink-0" />
    </div>
  );
}

function Sidebar({
  page,
  onNavigate,
  connected,
  siteLabel,
  currentView,
  onViewChange,
}: {
  page: Page;
  onNavigate: (page: Page) => void;
  connected: boolean;
  siteLabel: string | null;
  currentView?: ReportView;
  onViewChange?: (view: ReportView) => void;
}) {
  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-sidebar-border bg-sidebar md:min-h-screen md:w-[224px] md:border-b-0 md:border-r">
      <div className="flex items-center justify-between">
        <BrandMark />
        <LogoutButton className="mr-3 md:hidden" />
      </div>
      <div className="flex gap-1 px-3 pb-3 md:flex-col md:pb-0">
        <button
          className={`nav-item ${page === "reports" && currentView !== "monthly" && currentView !== "quarterly" ? "nav-item-active" : ""}`}
          onClick={() => {
            onNavigate("reports");
            if (currentView === "monthly" || currentView === "quarterly") onViewChange?.("overview");
          }}
          aria-current={page === "reports" && currentView !== "monthly" && currentView !== "quarterly" ? "page" : undefined}
        >
          <span className="nav-glyph" aria-hidden="true">
            R
          </span>
          <span>Sprint reports</span>
        </button>
        <button
          className={`nav-item ${page === "reports" && currentView === "monthly" ? "nav-item-active" : ""}`}
          onClick={() => {
            onNavigate("reports");
            onViewChange?.("monthly");
          }}
          aria-current={page === "reports" && currentView === "monthly" ? "page" : undefined}
        >
          <span className="nav-glyph" aria-hidden="true">
            M
          </span>
          <span>Monthly tracking</span>
        </button>
        <button
          className={`nav-item ${page === "reports" && currentView === "quarterly" ? "nav-item-active" : ""}`}
          onClick={() => {
            onNavigate("reports");
            onViewChange?.("quarterly");
          }}
          aria-current={page === "reports" && currentView === "quarterly" ? "page" : undefined}
        >
          <span className="nav-glyph" aria-hidden="true">
            Q
          </span>
          <span>Quarterly tracking</span>
        </button>
        <button
          className={`nav-item ${page === "automation" ? "nav-item-active" : ""}`}
          onClick={() => onNavigate("automation")}
          aria-current={page === "automation" ? "page" : undefined}
        >
          <span className="nav-glyph" aria-hidden="true">
            A
          </span>
          <span>Automation</span>
        </button>
      </div>
      <div className="mt-auto hidden px-3 pb-4 md:block">
        <div className="source-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-foreground">
              Jira Cloud
            </span>
            <span
              className="status-dot"
              data-state={connected ? "connected" : "disconnected"}
              aria-label={connected ? "Connected" : "Not connected"}
            />
          </div>
          <div className="mt-1 truncate text-[11px] text-muted-foreground">
            {connected ? siteLabel || "Connected" : "No API key"}
          </div>
          {connected ? (
            <a
              href={JIRA_SETTINGS_URL}
              className="mt-3 inline-block text-[11px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Manage API key
            </a>
          ) : (
            <button
              onClick={() => onNavigate("reports")}
              className="mt-3 text-[11px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Add Jira API key
            </button>
          )}
        </div>
        <AccountRow />
      </div>
    </aside>
  );
}

interface SprintReport {
  sprint: {
    id: string;
    boardId: string;
    boardName: string;
    name: string;
    state: string;
    goal: string;
    startDate: string | null;
    endDate: string | null;
    completeDate: string | null;
    syncedAt: string;
  };
  totals: {
    issueCount: number;
    committedPoints: number;
    completedPoints: number;
    remainingPoints: number;
    completionPct: number;
    todoCount: number;
    inProgressCount: number;
    doneCount: number;
    carryForwardCount: number;
    loggedHours: number;
    worklogEntryCount: number;
  };
  statusBreakdown: { status: string; statusCategory: string; count: number }[];
  statusBuckets?: Record<StatusBucket, number>;
  team: {
    assigneeAccountId: string | null;
    assigneeName: string;
    committedPoints: number;
    completedPoints: number;
    totalCount: number;
    doneCount: number;
    loggedHours: number;
  }[];
  carryForward: {
    key: string;
    summary: string;
    status: string;
    assigneeName: string;
    storyPoints: number | null;
    loggedHours: number;
  }[];
  workLog: {
    window: { from: string; to: string; timeZone: string } | null;
    byMember: { accountId: string; name: string; loggedHours: number; entryCount: number }[];
    byIssue: {
      key: string;
      summary: string;
      assigneeName: string;
      inSprint: boolean;
      loggedHours: number;
    }[];
    entries: {
      id: string;
      issueKey: string;
      summary: string;
      inSprint: boolean;
      authorName: string;
      hours: number;
      started: string;
    }[];
  };
}

type StatusBucket = "todo" | "in-progress" | "completed" | "deployed";

// Same buckets as statusBucket() in server/lib/sprint-report.ts.
const ticketFilters: { id: StatusBucket | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "todo", label: "To Do" },
  { id: "in-progress", label: "In Progress" },
  { id: "completed", label: "Completed" },
  { id: "deployed", label: "Deployed" },
];

function formatHours(hours: number): string {
  return `${hours} h`;
}

function statusIndicatorClass(category: string): string {
  if (category === "done") return "state-done";
  if (category === "indeterminate") return "state-progress";
  return "state-todo";
}

function statusIndicatorColor(category: string): string {
  if (category === "done") return "hsl(var(--report-positive))";
  if (category === "indeterminate") return "hsl(var(--report-warning))";
  return "hsl(var(--muted-foreground))";
}

// Grouped column chart: a fixed set of point metrics (Committed, Completed),
// each split into a "Current sprint" / "Previous sprint" pair. Two
// categorical series, fixed color-current/color-previous order, direct
// value labels (only 4 bars total, so labeling every one is fine), native
// <title> hover per bar.
function SprintComparisonChart({
  current,
  previous,
}: {
  current: { committedPoints: number; completedPoints: number };
  previous: { committedPoints: number; completedPoints: number };
}) {
  const groups = [
    { label: "Committed", current: current.committedPoints, previous: previous.committedPoints },
    { label: "Completed", current: current.completedPoints, previous: previous.completedPoints },
  ];
  const max = Math.max(1, ...groups.flatMap((g) => [g.current, g.previous]));
  const chartHeight = 140;
  const barWidth = 28;
  const groupGap = 56;
  const seriesGap = 4;
  const groupWidth = barWidth * 2 + seriesGap;
  const width = groups.length * groupWidth + (groups.length - 1) * groupGap + 32;

  const bar = (value: number, x: number, color: string, label: string) => {
    const h = Math.round((value / max) * chartHeight);
    const y = chartHeight - h;
    return (
      <g key={label}>
        <title>{`${label}: ${value.toLocaleString()} pts`}</title>
        <rect x={x} y={y} width={barWidth} height={Math.max(h, 2)} rx={4} fill={color} />
        <text
          x={x + barWidth / 2}
          y={y - 6}
          textAnchor="middle"
          fontSize="10"
          style={{ fontVariantNumeric: "tabular-nums" }}
          fill="hsl(var(--foreground))"
        >
          {value.toLocaleString()}
        </text>
      </g>
    );
  };

  return (
    <div>
      <div className="mb-3 flex items-center gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: "var(--chart-current)" }}
          />
          Current sprint
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: "var(--chart-previous)" }}
          />
          Previous sprint
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${chartHeight + 36}`}
        width="100%"
        height={chartHeight + 36}
        role="img"
        aria-label="Committed and completed points, current sprint vs previous sprint"
      >
        <line
          x1={0}
          y1={chartHeight}
          x2={width}
          y2={chartHeight}
          stroke="var(--chart-axis)"
          strokeWidth={1}
        />
        {groups.map((g, i) => {
          const gx = 16 + i * (groupWidth + groupGap);
          return (
            <g key={g.label}>
              {bar(g.current, gx, "var(--chart-current)", `${g.label} · current`)}
              {bar(
                g.previous,
                gx + barWidth + seriesGap,
                "var(--chart-previous)",
                `${g.label} · previous`,
              )}
              <text
                x={gx + groupWidth / 2}
                y={chartHeight + 20}
                textAnchor="middle"
                fontSize="11"
                fill="hsl(var(--muted-foreground))"
              >
                {g.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// Horizontal bars for one sprint's own status breakdown (To Do / In
// Progress / Done) — a single series encoded by the app's existing status
// colors (state-todo/progress/done), not the current/previous categorical
// pair, since this isn't a comparison.
function StatusBreakdownChart({
  totals,
}: {
  totals: { todoCount: number; inProgressCount: number; doneCount: number };
}) {
  const rows = [
    { label: "To Do", value: totals.todoCount, category: "new" },
    { label: "In Progress", value: totals.inProgressCount, category: "indeterminate" },
    { label: "Done", value: totals.doneCount, category: "done" },
  ];
  const max = Math.max(1, ...rows.map((r) => r.value));
  const trackWidth = 100;

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center gap-3 text-xs">
          <span className="w-20 shrink-0 text-muted-foreground">{row.label}</span>
          <svg
            viewBox={`0 0 ${trackWidth} 10`}
            width="100%"
            height={10}
            preserveAspectRatio="none"
            role="img"
            aria-label={`${row.label}: ${row.value} tickets`}
          >
            <title>{`${row.label}: ${row.value} ticket${row.value === 1 ? "" : "s"}`}</title>
            <rect x={0} y={0} width={trackWidth} height={10} rx={4} fill="var(--chart-grid)" />
            <rect
              x={0}
              y={0}
              width={Math.max((row.value / max) * trackWidth, row.value > 0 ? 4 : 0)}
              height={10}
              rx={4}
              fill={statusIndicatorColor(row.category)}
            />
          </svg>
          <span className="w-8 shrink-0 text-right tabular-nums text-foreground">
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function TeamDeltaBadge({
  current,
  previous,
  unit = "pts",
}: {
  current: number;
  previous: number;
  unit?: string;
}) {
  const delta = Math.round((current - previous) * 10) / 10;
  const suffix = unit ? ` ${unit}` : "";
  if (delta === 0) {
    return <span className="text-muted-foreground">±0{suffix}</span>;
  }
  const up = delta > 0;
  return (
    <span
      style={{
        color: up ? "hsl(var(--report-positive))" : "hsl(var(--destructive))",
      }}
    >
      {up ? "▲" : "▼"} {Math.abs(delta)}
      {suffix}
    </span>
  );
}

// Members excluded from every report (set-member-exclusion). Threaded down
// to the Team view so rows can be hidden and the excluded list restored.
interface MemberExclusion {
  members: { accountId: string; name: string }[];
  onExclude: (accountId: string) => void;
  onRestore: (accountId: string) => void;
  pending: boolean;
}

function HideMemberButton({
  accountId,
  name,
  exclusion,
}: {
  accountId: string | null;
  name: string;
  exclusion?: MemberExclusion;
}) {
  if (!exclusion || !accountId) return null;
  return (
    <button
      type="button"
      className="text-[11px] text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50"
      onClick={() => exclusion.onExclude(accountId)}
      disabled={exclusion.pending}
      aria-label={`Exclude ${name} from reports`}
      title="Exclude from all reports"
    >
      Exclude
    </button>
  );
}

function ExcludedMembersList({ exclusion }: { exclusion?: MemberExclusion }) {
  if (!exclusion || exclusion.members.length === 0) return null;
  return (
    <div className="mt-8 border-t border-border pt-6">
      <h3 className="text-xs font-semibold text-foreground">
        Excluded members ({exclusion.members.length})
      </h3>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Left out of every total, chart, ticket list, and export.
      </p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {exclusion.members.map((m) => (
          <li
            key={m.accountId}
            className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1 text-xs"
          >
            <span className="text-foreground">{m.name}</span>
            <button
              type="button"
              className="text-[11px] text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50"
              onClick={() => exclusion.onRestore(m.accountId)}
              disabled={exclusion.pending}
              aria-label={`Restore ${m.name} to reports`}
            >
              Restore
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Member-wise previous-vs-current table. Rows are the union of both sprints'
// active members, ordered by previous-sprint commitment so the table reads as
// a previous-sprint report first; members only in the current sprint follow.
function MemberComparisonTable({
  report,
  previous,
  exclusion,
  filterMemberId,
}: {
  report: SprintReport;
  previous: SprintReport;
  exclusion?: MemberExclusion;
  filterMemberId?: string;
}) {
  type TeamRow = SprintReport["team"][number];
  const currentById = new Map(report.team.map((r) => [r.assigneeAccountId, r]));
  const previousIds = new Set(previous.team.map((r) => r.assigneeAccountId));
  const allRows: { id: string | null; name: string; prev?: TeamRow; curr?: TeamRow }[] = [
    ...previous.team.map((prev) => ({
      id: prev.assigneeAccountId,
      name: prev.assigneeName,
      prev,
      curr: currentById.get(prev.assigneeAccountId),
    })),
    ...report.team
      .filter((curr) => !previousIds.has(curr.assigneeAccountId))
      .map((curr) => ({ id: curr.assigneeAccountId, name: curr.assigneeName, curr })),
  ];
  const rows = allRows.filter(
    (r) => !filterMemberId || r.id === filterMemberId || r.name === filterMemberId,
  );
  const pct = (r: TeamRow) =>
    r.committedPoints > 0
      ? Math.round((r.completedPoints / r.committedPoints) * 1000) / 10
      : 0;

  return (
    <div className="mt-6 overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-xs">
        <thead className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
          <tr>
            <th rowSpan={2} className="py-2 pr-3 align-bottom font-medium">
              Team member
            </th>
            <th colSpan={5} className="pt-2 pr-3 text-right font-medium">
              {previous.sprint.name}
            </th>
            <th colSpan={3} className="pt-2 pr-3 text-right font-medium">
              {report.sprint.name}
            </th>
            <th rowSpan={2} className="py-2 pr-3 text-right align-bottom font-medium">
              Δ completed
            </th>
            {exclusion ? (
              <th rowSpan={2} className="py-2 align-bottom">
                <span className="sr-only">Actions</span>
              </th>
            ) : null}
          </tr>
          <tr>
            <th className="py-2 pr-3 text-right font-medium">Committed</th>
            <th className="py-2 pr-3 text-right font-medium">Completed</th>
            <th className="py-2 pr-3 text-right font-medium">Done %</th>
            <th className="py-2 pr-3 text-right font-medium">Tickets</th>
            <th className="py-2 pr-3 text-right font-medium">Logged</th>
            <th className="py-2 pr-3 text-right font-medium">Completed</th>
            <th className="py-2 pr-3 text-right font-medium">Done %</th>
            <th className="py-2 pr-3 text-right font-medium">Logged</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(({ id, name, prev, curr }) => (
            <tr key={id ?? name}>
              <td className="py-2 pr-3 font-medium text-foreground">{name}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                {prev ? `${prev.committedPoints} pts` : "—"}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-foreground">
                {prev ? `${prev.completedPoints} pts` : "—"}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                {prev ? `${pct(prev)}%` : "—"}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                {prev ? `${prev.doneCount}/${prev.totalCount}` : "—"}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                {prev ? formatHours(prev.loggedHours ?? 0) : "—"}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-foreground">
                {curr ? `${curr.completedPoints} pts` : "—"}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                {curr ? `${pct(curr)}%` : "—"}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                {curr ? formatHours(curr.loggedHours) : "—"}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">
                <TeamDeltaBadge
                  current={curr?.completedPoints ?? 0}
                  previous={prev?.completedPoints ?? 0}
                />
              </td>
              {exclusion ? (
                <td className="py-2 text-right">
                  <HideMemberButton accountId={id} name={name} exclusion={exclusion} />
                </td>
              ) : null}
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td className="py-2 text-muted-foreground" colSpan={exclusion ? 11 : 10}>
                No active team members assigned in either sprint.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function TicketDetails({ report }: { report: SprintReport }) {
  const [filter, setFilter] = useState<StatusBucket | "all">("all");
  const boardId = report.sprint.boardId;
  const tickets = useActionQuery(
    "list-sprint-issues",
    { boardId, ...(filter === "all" ? {} : { bucket: filter }) },
    { placeholderData: (prev: unknown) => prev },
  );

  // Let the agent see which ticket filter is on screen (view-screen).
  useEffect(() => {
    writeClientAppState("sprint-reporting-ticket-filter", { filter }).catch(() => {});
  }, [filter]);

  const counts = report.statusBuckets;
  const countFor = (id: StatusBucket | "all") =>
    id === "all" ? report.totals.issueCount : (counts?.[id] ?? 0);
  const rows = (tickets.data ?? []) as {
    key: string;
    summary: string;
    status: string;
    statusCategory: string;
    assigneeName: string | null;
    storyPoints: number | null;
    loggedHours: number;
  }[];

  return (
    <section className="surface overflow-hidden" aria-labelledby="ticket-heading">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h2 id="ticket-heading" className="text-sm font-semibold">
          Ticket details
        </h2>
        <span className="preview-label">{report.sprint.name}</span>
      </div>
      <div
        className="flex gap-1 overflow-x-auto border-b border-border px-4 py-2"
        role="tablist"
        aria-label="Filter tickets by status"
      >
        {ticketFilters.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={filter === f.id}
            className={`report-tab whitespace-nowrap ${filter === f.id ? "report-tab-active" : ""}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}{" "}
            <span className="tabular-nums text-muted-foreground">{countFor(f.id)}</span>
          </button>
        ))}
      </div>
      <div className={`overflow-x-auto ${tickets.isFetching ? "opacity-60" : ""}`}>
        <table className="w-full min-w-[680px] text-left text-xs">
          <thead className="bg-muted/60 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-medium">Ticket</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Assignee</th>
              <th className="px-5 py-3 text-right font-medium">Points</th>
              <th className="px-5 py-3 text-right font-medium">Logged</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.key} className="border-t border-border">
                <td className="px-5 py-3">
                  <span className="font-medium text-foreground">{t.key}</span>{" "}
                  <span className="text-muted-foreground">{t.summary}</span>
                </td>
                <td className="whitespace-nowrap px-5 py-3">
                  <span className={`state-indicator ${statusIndicatorClass(t.statusCategory)}`} />
                  {t.status}
                </td>
                <td className="px-5 py-3 text-muted-foreground">{t.assigneeName ?? "—"}</td>
                <td className="px-5 py-3 text-right tabular-nums">{t.storyPoints ?? "—"}</td>
                <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                  {formatHours(t.loggedHours)}
                </td>
              </tr>
            ))}
            {tickets.isError ? (
              <tr className="border-t border-border">
                <td className="px-5 py-4 text-destructive" colSpan={5}>
                  {actionErrorMessage(tickets.error) ?? "Couldn't load tickets."}
                </td>
              </tr>
            ) : tickets.isLoading ? (
              <tr className="border-t border-border">
                <td className="px-5 py-4 text-muted-foreground" colSpan={5}>
                  Loading tickets…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr className="border-t border-border">
                <td className="px-5 py-4 text-muted-foreground" colSpan={5}>
                  No tickets in this filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="border-t border-border px-5 py-3 text-[11px] text-muted-foreground">
        {rows.length} of {report.totals.issueCount} ticket
        {report.totals.issueCount === 1 ? "" : "s"}. Deployed = any status whose
        name contains “deploy”; Completed = other Done statuses.
      </div>
    </section>
  );
}

const WORK_LOG_ENTRY_PREVIEW = 50;

// A YYYY-MM-DD calendar day, shown without shifting it through a time zone.
function formatDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatLogDate(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone });
}

// Time logged in Jira during the sprint window (sprint start → completion,
// or today while active), by member, by ticket, and entry by entry.
function WorkLogSection({
  report,
  previous,
}: {
  report: SprintReport;
  previous?: SprintReport | null;
}) {
  const [showAllEntries, setShowAllEntries] = useState(false);
  const { workLog, totals } = report;
  const prevByMember = new Map(
    (previous?.workLog?.byMember ?? []).map((m) => [m.accountId, m]),
  );
  const currentIds = new Set(workLog.byMember.map((m) => m.accountId));
  const members = [
    ...workLog.byMember.map((m) => ({ ...m, prev: prevByMember.get(m.accountId) })),
    ...(previous?.workLog?.byMember ?? [])
      .filter((m) => !currentIds.has(m.accountId))
      .map((m) => ({ accountId: m.accountId, name: m.name, loggedHours: 0, entryCount: 0, prev: m })),
  ];
  const entries = showAllEntries
    ? workLog.entries
    : workLog.entries.slice(0, WORK_LOG_ENTRY_PREVIEW);
  return (
    <section className="surface p-5 sm:p-6" aria-labelledby="work-log-heading">
      <div className="flex items-center justify-between gap-3">
        <h2 id="work-log-heading" className="text-sm font-semibold">
          Work log
        </h2>
        <span className="preview-label">{report.sprint.name}</span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {workLog.window
          ? `All time logged on this board's projects from ${formatDay(workLog.window.from)} to ${formatDay(workLog.window.to)} (${workLog.window.timeZone}), counted like a Timela timesheet for those dates — including tickets outside the sprint. Excluded and deactivated members are left out.`
          : "This sprint has no start date, so there's no date range to count work logs for."}
      </p>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div>
          <div className="text-[11px] text-muted-foreground">Logged</div>
          <div className="mt-1 tabular-nums text-2xl font-semibold tracking-[-0.04em]">
            {formatHours(totals.loggedHours)}
          </div>
          {previous ? (
            <div className="mt-1 text-[11px] tabular-nums">
              <TeamDeltaBadge
                current={totals.loggedHours}
                previous={previous.totals.loggedHours ?? 0}
                unit="h"
              />{" "}
              <span className="text-muted-foreground">vs {previous.sprint.name}</span>
            </div>
          ) : null}
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground">Entries</div>
          <div className="mt-1 tabular-nums text-2xl font-semibold tracking-[-0.04em]">
            {totals.worklogEntryCount}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground">Members logging</div>
          <div className="mt-1 tabular-nums text-2xl font-semibold tracking-[-0.04em]">
            {workLog.byMember.length}
          </div>
        </div>
      </div>

      <h3 className="mt-8 border-t border-border pt-6 text-xs font-semibold text-foreground">
        By team member
      </h3>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[480px] text-left text-xs">
          <thead className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
            <tr>
              <th className="py-2 pr-3 font-medium">Team member</th>
              <th className="py-2 pr-3 text-right font-medium">{report.sprint.name}</th>
              <th className="py-2 pr-3 text-right font-medium">Entries</th>
              {previous ? (
                <>
                  <th className="py-2 pr-3 text-right font-medium">{previous.sprint.name}</th>
                  <th className="py-2 text-right font-medium">Δ</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {members.map((m) => (
              <tr key={m.accountId}>
                <td className="py-2 pr-3 font-medium text-foreground">{m.name}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-foreground">
                  {formatHours(m.loggedHours)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                  {m.entryCount}
                </td>
                {previous ? (
                  <>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                      {m.prev ? formatHours(m.prev.loggedHours) : "—"}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      <TeamDeltaBadge
                        current={m.loggedHours}
                        previous={m.prev?.loggedHours ?? 0}
                        unit="h"
                      />
                    </td>
                  </>
                ) : null}
              </tr>
            ))}
            {members.length === 0 ? (
              <tr>
                <td className="py-2 text-muted-foreground" colSpan={previous ? 5 : 3}>
                  No work logged in this sprint yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {workLog.byIssue.length > 0 ? (
        <>
          <h3 className="mt-8 border-t border-border pt-6 text-xs font-semibold text-foreground">
            By ticket
          </h3>
          <div className="mt-3 max-h-[360px] overflow-auto">
            <table className="w-full min-w-[480px] text-left text-xs">
              <thead className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3 font-medium">Ticket</th>
                  <th className="py-2 pr-3 font-medium">Assignee</th>
                  <th className="py-2 text-right font-medium">Logged</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {workLog.byIssue.map((row) => (
                  <tr key={row.key}>
                    <td className="py-2 pr-3">
                      <span className="font-medium text-foreground">{row.key}</span>{" "}
                      {row.inSprint ? (
                        <span className="text-muted-foreground">{row.summary}</span>
                      ) : (
                        <span className="preview-label">Not in sprint</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {row.inSprint ? row.assigneeName || "Unassigned" : "—"}
                    </td>
                    <td className="py-2 text-right tabular-nums text-foreground">
                      {formatHours(row.loggedHours)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {workLog.entries.length > 0 ? (
        <>
          <h3 className="mt-8 border-t border-border pt-6 text-xs font-semibold text-foreground">
            Entries
          </h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-xs">
              <thead className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">Team member</th>
                  <th className="py-2 pr-3 font-medium">Ticket</th>
                  <th className="py-2 text-right font-medium">Hours</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="py-2 pr-3 tabular-nums text-muted-foreground">
                      {formatLogDate(e.started, workLog.window?.timeZone)}
                    </td>
                    <td className="py-2 pr-3 text-foreground">{e.authorName}</td>
                    <td className="py-2 pr-3">
                      <span className="font-medium text-foreground">{e.issueKey}</span>{" "}
                      {e.inSprint ? (
                        <span className="text-muted-foreground">{e.summary}</span>
                      ) : (
                        <span className="preview-label">Not in sprint</span>
                      )}
                    </td>
                    <td className="py-2 text-right tabular-nums text-foreground">
                      {formatHours(e.hours)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {workLog.entries.length > WORK_LOG_ENTRY_PREVIEW ? (
            <button
              type="button"
              className="mt-3 text-[11px] text-muted-foreground hover:text-foreground hover:underline"
              onClick={() => setShowAllEntries((v) => !v)}
            >
              {showAllEntries
                ? "Show fewer"
                : `Show all ${workLog.entries.length} entries`}
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

type TeamPeriod = "sprint" | "mom" | "current" | "previous" | string;

interface TeamRow {
  id: string;
  name: string;
  curSprintCompleted?: number;
  curSprintCommitted?: number;
  curSprintDone?: number;
  curSprintTotal?: number;
  curSprintLogged?: number;
  prevSprintCompleted?: number;
  prevSprintCommitted?: number;
  prevSprintDone?: number;
  prevSprintTotal?: number;
  prevSprintLogged?: number;
  prevMonthCompleted?: number;
  prevMonthCommitted?: number;
  prevMonthDone?: number;
  prevMonthTotal?: number;
  prevMonthLogged?: number;
  curMonthCompleted?: number;
  curMonthCommitted?: number;
  curMonthDone?: number;
  curMonthTotal?: number;
  curMonthLogged?: number;
}

function TeamPerformanceSection({
  report,
  previous,
  exclusion,
  onViewChange,
}: {
  report: SprintReport;
  previous?: SprintReport | null;
  exclusion?: MemberExclusion;
  onViewChange?: (view: ReportView) => void;
}) {
  const [periodFilter, setPeriodFilter] = useState<TeamPeriod>("sprint");
  const [memberFilter, setMemberFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const monthlyQuery = useActionQuery(
    "get-monthly-report",
    { boardId: report.sprint.boardId, month: "all" },
    { placeholderData: (prev: unknown) => prev },
  );
  const monthlyData = monthlyQuery.data as MonthlyReportData | undefined;

  useEffect(() => {
    writeClientAppState("sprint-reporting-team-filter", {
      period: periodFilter,
      member: memberFilter,
      search: searchQuery || undefined,
    }).catch(() => {});
  }, [periodFilter, memberFilter, searchQuery]);

  const selectedMonthData = useMemo(() => {
    if (!monthlyData) return null;
    if (periodFilter === "sprint" || periodFilter === "mom") return null;
    if (periodFilter === "current") return monthlyData.current;
    if (periodFilter === "previous") return monthlyData.previous;
    const lower = periodFilter.toLowerCase();
    return (
      monthlyData.byMonth?.[periodFilter] ||
      monthlyData.byMonth?.[lower] ||
      null
    );
  }, [monthlyData, periodFilter]);

  const allMembers = useMemo<Array<{ id: string; name: string }>>(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const m of report.team) {
      const id = m.assigneeAccountId ?? m.assigneeName;
      map.set(id, { id, name: m.assigneeName });
    }
    if (previous?.team) {
      for (const m of previous.team) {
        const id = m.assigneeAccountId ?? m.assigneeName;
        if (!map.has(id)) map.set(id, { id, name: m.assigneeName });
      }
    }
    if (monthlyData) {
      for (const m of monthlyData.current.team) {
        const id = m.assigneeAccountId ?? m.assigneeName;
        if (!map.has(id)) map.set(id, { id, name: m.assigneeName });
      }
      for (const m of monthlyData.previous.team) {
        const id = m.assigneeAccountId ?? m.assigneeName;
        if (!map.has(id)) map.set(id, { id, name: m.assigneeName });
      }
      for (const issue of monthlyData.allIssues) {
        if (!issue.assigneeName) continue;
        const id = issue.assigneeAccountId ?? issue.assigneeName;
        if (!map.has(id)) map.set(id, { id, name: issue.assigneeName });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [report.team, previous?.team, monthlyData]);

  const activeMetrics = useMemo(() => {
    const isMember = memberFilter !== "all";
    const selectedMember = allMembers.find((m) => m.id === memberFilter);
    const memberName = selectedMember?.name ?? "All Team Members";

    if (periodFilter === "sprint") {
      if (!isMember) {
        return {
          isMember: false,
          name: "All Team Members",
          title: "Sprint commitment completed",
          periodLabel: report.sprint.name,
          completionPct: report.totals.completionPct,
          completedPoints: report.totals.completedPoints,
          committedPoints: report.totals.committedPoints,
          secondaryLabel: "Carry-forward",
          secondaryValue: `${report.totals.carryForwardCount} tickets`,
          loggedHours: report.totals.loggedHours,
        };
      }
      const sMember = report.team.find(
        (m) => (m.assigneeAccountId ?? m.assigneeName) === memberFilter,
      );
      const completed = sMember?.completedPoints ?? 0;
      const committed = sMember?.committedPoints ?? 0;
      const pct =
        committed > 0 ? Math.round((completed / committed) * 1000) / 10 : 0;
      const memberCarryForward = report.carryForward.filter(
        (c) => c.assigneeName === sMember?.assigneeName,
      ).length;
      return {
        isMember: true,
        name: memberName,
        title: `${memberName}'s sprint commitment completed`,
        periodLabel: report.sprint.name,
        completionPct: pct,
        completedPoints: completed,
        committedPoints: committed,
        secondaryLabel: "Member carry-forward",
        secondaryValue: `${memberCarryForward} tickets`,
        loggedHours: sMember?.loggedHours ?? 0,
      };
    }

    if (selectedMonthData) {
      const cur = selectedMonthData;
      if (!isMember) {
        return {
          isMember: false,
          name: "All Team Members",
          title: `Team completion (${cur.meta.label})`,
          periodLabel: cur.meta.label,
          completionPct: cur.totals.completionPct,
          completedPoints: cur.totals.completedPoints,
          committedPoints: cur.totals.committedPoints,
          secondaryLabel: "Done tickets",
          secondaryValue: `${cur.totals.doneCount} / ${cur.totals.issueCount} tickets`,
          loggedHours: cur.totals.loggedHours,
        };
      }
      const cMember = cur.team.find(
        (m) => (m.assigneeAccountId ?? m.assigneeName) === memberFilter,
      );
      const completed = cMember?.completedPoints ?? 0;
      const committed = cMember?.committedPoints ?? 0;
      const pct =
        committed > 0 ? Math.round((completed / committed) * 1000) / 10 : 0;
      return {
        isMember: true,
        name: memberName,
        title: `${memberName}'s completion (${cur.meta.label})`,
        periodLabel: cur.meta.label,
        completionPct: pct,
        completedPoints: completed,
        committedPoints: committed,
        secondaryLabel: "Done tickets",
        secondaryValue: `${cMember?.doneCount ?? 0} / ${cMember?.totalCount ?? 0} tickets`,
        loggedHours: cMember?.loggedHours ?? 0,
      };
    }

    if (periodFilter === "mom" && monthlyData) {
      const cur = monthlyData.current;
      const prev = monthlyData.previous;
      if (!isMember) {
        return {
          isMember: false,
          name: "All Team Members",
          title: `Team MoM Velocity (${prev.meta.shortLabel} → ${cur.meta.shortLabel})`,
          periodLabel: `${prev.meta.shortLabel} vs ${cur.meta.shortLabel}`,
          completionPct: cur.totals.completionPct,
          completedPoints: cur.totals.completedPoints,
          committedPoints: cur.totals.committedPoints,
          secondaryLabel: "MoM Points Delta",
          secondaryValue: `${monthlyData.comparison.completedPointsDelta >= 0 ? "+" : ""}${monthlyData.comparison.completedPointsDelta} pts`,
          loggedHours: cur.totals.loggedHours,
        };
      }
      const cMember = cur.team.find(
        (m) => (m.assigneeAccountId ?? m.assigneeName) === memberFilter,
      );
      const pMember = prev.team.find(
        (m) => (m.assigneeAccountId ?? m.assigneeName) === memberFilter,
      );
      const cCompleted = cMember?.completedPoints ?? 0;
      const pCompleted = pMember?.completedPoints ?? 0;
      const delta = Math.round((cCompleted - pCompleted) * 10) / 10;
      const cCommitted = cMember?.committedPoints ?? 0;
      const pct =
        cCommitted > 0 ? Math.round((cCompleted / cCommitted) * 1000) / 10 : 0;
      return {
        isMember: true,
        name: memberName,
        title: `${memberName}'s MoM Delta (${prev.meta.shortLabel} → ${cur.meta.shortLabel})`,
        periodLabel: `${prev.meta.shortLabel} vs ${cur.meta.shortLabel}`,
        completionPct: pct,
        completedPoints: cCompleted,
        committedPoints: cCommitted,
        secondaryLabel: "MoM Points Delta",
        secondaryValue: `${delta >= 0 ? "+" : ""}${delta} pts`,
        loggedHours: cMember?.loggedHours ?? 0,
      };
    }

    return {
      isMember,
      name: memberName,
      title: "Team commitment completed",
      periodLabel: report.sprint.name,
      completionPct: report.totals.completionPct,
      completedPoints: report.totals.completedPoints,
      committedPoints: report.totals.committedPoints,
      secondaryLabel: "Carry-forward",
      secondaryValue: `${report.totals.carryForwardCount} tickets`,
      loggedHours: report.totals.loggedHours,
    };
  }, [periodFilter, memberFilter, allMembers, report, previous, monthlyData, selectedMonthData]);

  const displayedRows = useMemo<TeamRow[]>(() => {
    let rows: TeamRow[] = [];

    if (periodFilter === "sprint") {
      rows = report.team.map((r) => {
        const id = r.assigneeAccountId ?? r.assigneeName;
        const prevRow = previous?.team.find(
          (p) => (p.assigneeAccountId ?? p.assigneeName) === id,
        );
        return {
          id,
          name: r.assigneeName,
          curSprintCompleted: r.completedPoints,
          curSprintCommitted: r.committedPoints,
          curSprintDone: r.doneCount,
          curSprintTotal: r.totalCount,
          curSprintLogged: r.loggedHours,
          prevSprintCompleted: prevRow?.completedPoints,
          prevSprintCommitted: prevRow?.committedPoints,
          prevSprintDone: prevRow?.doneCount,
          prevSprintTotal: prevRow?.totalCount,
          prevSprintLogged: prevRow?.loggedHours,
        };
      });
    } else if (selectedMonthData) {
      rows = selectedMonthData.team.map((m) => {
        const id = m.assigneeAccountId ?? m.assigneeName;
        return {
          id,
          name: m.assigneeName,
          curMonthCompleted: m.completedPoints,
          curMonthCommitted: m.committedPoints,
          curMonthDone: m.doneCount,
          curMonthTotal: m.totalCount,
          curMonthLogged: m.loggedHours,
        };
      });
    } else if (monthlyData) {
      const allKeys = Array.from(
        new Set([
          ...monthlyData.current.team.map((m) => m.assigneeAccountId ?? m.assigneeName),
          ...monthlyData.previous.team.map((m) => m.assigneeAccountId ?? m.assigneeName),
        ]),
      );
      rows = allKeys.map((id) => {
        const cMember = monthlyData.current.team.find(
          (m) => (m.assigneeAccountId ?? m.assigneeName) === id,
        );
        const pMember = monthlyData.previous.team.find(
          (m) => (m.assigneeAccountId ?? m.assigneeName) === id,
        );
        const name =
          cMember?.assigneeName ?? pMember?.assigneeName ?? "Unassigned";
        return {
          id,
          name,
          prevMonthCompleted: pMember?.completedPoints ?? 0,
          prevMonthCommitted: pMember?.committedPoints ?? 0,
          prevMonthDone: pMember?.doneCount ?? 0,
          prevMonthTotal: pMember?.totalCount ?? 0,
          prevMonthLogged: pMember?.loggedHours ?? 0,
          curMonthCompleted: cMember?.completedPoints ?? 0,
          curMonthCommitted: cMember?.committedPoints ?? 0,
          curMonthDone: cMember?.doneCount ?? 0,
          curMonthTotal: cMember?.totalCount ?? 0,
          curMonthLogged: cMember?.loggedHours ?? 0,
        };
      });
    } else {
      rows = report.team.map((r) => ({
        id: r.assigneeAccountId ?? r.assigneeName,
        name: r.assigneeName,
        curSprintCompleted: r.completedPoints,
        curSprintCommitted: r.committedPoints,
        curSprintDone: r.doneCount,
        curSprintTotal: r.totalCount,
        curSprintLogged: r.loggedHours,
      }));
    }

    if (memberFilter !== "all") {
      rows = rows.filter((r) => r.id === memberFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(q));
    }
    return rows;
  }, [periodFilter, report, previous, monthlyData, selectedMonthData, memberFilter, searchQuery]);

  return (
    <section className="surface p-5 sm:p-6" aria-labelledby="team-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 id="team-heading" className="text-sm font-semibold text-foreground">
              Team performance
            </h2>
            <span className="preview-label">{activeMetrics.periodLabel}</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Review velocity, story points, and performance by month and team member.
          </p>
        </div>

        {/* View Switcher: Switch to Month-wise tracking */}
        <div className="flex items-center gap-2">
          {onViewChange && (
            <button
              type="button"
              onClick={() => onViewChange("monthly")}
              className="secondary-button text-xs font-medium"
            >
              Switch to Month-wise tracking →
            </button>
          )}
        </div>
      </div>

      {/* Dual Filter Bar: Scope / Month & Team Member */}
      <div className="mt-5 space-y-3 border-t border-border pt-4">
        {/* Row 1: Month / Scope Pills */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Month / Scope:</span>
            <div
              className="flex flex-wrap items-center gap-1 rounded-md bg-muted/60 p-1"
              role="tablist"
              aria-label="Filter by scope or month"
            >
              <button
                type="button"
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  periodFilter === "sprint"
                    ? "bg-card font-semibold text-foreground shadow-xs ring-1 ring-border"
                    : "text-muted-foreground hover:bg-card/50 hover:text-foreground"
                }`}
                onClick={() => setPeriodFilter("sprint")}
              >
                Sprint ({report.sprint.name})
              </button>
              <button
                type="button"
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  periodFilter === "mom"
                    ? "bg-card font-semibold text-foreground shadow-xs ring-1 ring-border"
                    : "text-muted-foreground hover:bg-card/50 hover:text-foreground"
                }`}
                onClick={() => setPeriodFilter("mom")}
              >
                All Months (MoM)
              </button>
              {(monthlyData?.months || []).map((m) => {
                const lower = m.shortMonthName.toLowerCase();
                const isSelected =
                  periodFilter === lower ||
                  periodFilter === m.shortMonthName ||
                  periodFilter === m.key ||
                  (periodFilter === "current" && m.isCurrent) ||
                  (periodFilter === "previous" && m.isPrevious);

                return (
                  <button
                    key={m.key}
                    type="button"
                    title={`${m.label} (${m.issueCount} tickets)`}
                    className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
                      isSelected
                        ? "bg-card font-semibold text-foreground shadow-xs ring-2 ring-primary"
                        : m.hasData
                          ? "text-foreground hover:bg-card/70"
                          : "text-muted-foreground/60 hover:text-muted-foreground hover:bg-card/30"
                    }`}
                    onClick={() => setPeriodFilter(isSelected ? "sprint" : lower)}
                  >
                    <span>{m.shortMonthName}</span>
                    {m.hasData && (
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          isSelected
                            ? "bg-primary"
                            : m.isCurrent
                              ? "bg-emerald-500 animate-pulse"
                              : "bg-blue-500"
                        }`}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Quick link to Month-wise tracking */}
          {onViewChange && periodFilter !== "sprint" && (
            <button
              type="button"
              onClick={() => onViewChange("monthly")}
              className="text-xs text-primary hover:underline"
            >
              View tickets in Monthly tracking →
            </button>
          )}
        </div>

        {/* Row 2: Team Member Select & Member Search */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Team Member:</span>
            <select
              value={memberFilter}
              onChange={(e) => setMemberFilter(e.target.value)}
              className="h-8 rounded-md border border-border bg-card px-3 text-xs font-medium text-foreground shadow-xs focus:border-primary focus:outline-hidden"
            >
              <option value="all">All Team Members ({allMembers.length})</option>
              {allMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            {memberFilter !== "all" && (
              <button
                type="button"
                onClick={() => setMemberFilter("all")}
                className="text-xs text-primary hover:underline"
              >
                Reset member
              </button>
            )}
          </div>

          <div className="w-full sm:w-60">
            <input
              type="search"
              placeholder="Search member name…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded border border-border bg-card px-2.5 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-hidden"
            />
          </div>
        </div>
      </div>

      {/* Selected Member Alert */}
      {activeMetrics.isMember && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-md bg-primary/10 px-3.5 py-2 text-xs text-primary">
          <span>
            Filtered to: <strong className="font-semibold text-foreground">{activeMetrics.name}</strong>{" "}
            in <strong className="font-semibold text-foreground">{activeMetrics.periodLabel}</strong>
          </span>
          <div className="flex items-center gap-3">
            {onViewChange && (
              <button
                type="button"
                onClick={() => onViewChange("monthly")}
                className="font-medium underline hover:text-foreground"
              >
                View tickets in Monthly tracking →
              </button>
            )}
            <button
              type="button"
              onClick={() => setMemberFilter("all")}
              className="font-semibold hover:text-foreground"
            >
              ✕ Clear member filter
            </button>
          </div>
        </div>
      )}

      {/* Dynamic Member / Team KPI Grid */}
      <div className="mt-6 grid gap-6 sm:grid-cols-[1fr_220px] sm:items-center">
        <div>
          <div className="text-[11px] text-muted-foreground">
            {activeMetrics.title}
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="tabular-nums text-4xl font-semibold tracking-[-0.06em]">
              {activeMetrics.completionPct}%
            </span>
            <span className="text-xs text-muted-foreground">
              {activeMetrics.completedPoints} of {activeMetrics.committedPoints} points
              {activeMetrics.loggedHours > 0 && ` · ${formatHours(activeMetrics.loggedHours)} logged`}
            </span>
          </div>
          <div className="progress-track mt-4">
            <span
              className="progress-fill"
              style={{ width: `${Math.min(100, activeMetrics.completionPct)}%` }}
            />
          </div>
        </div>
        <div className="border-l-0 border-border sm:border-l sm:pl-6">
          <div className="text-[11px] text-muted-foreground">
            {activeMetrics.secondaryLabel}
          </div>
          <div className="mt-2 tabular-nums text-2xl font-semibold tracking-[-0.04em]">
            {activeMetrics.secondaryValue}
          </div>
        </div>
      </div>

      {/* Member Table */}
      <div className="mt-6 overflow-x-auto border-t border-border">
        <table className="w-full min-w-[520px] text-left text-xs">
          <thead className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
            <tr>
              <th className="py-3 pr-3 font-medium">Team member</th>
              {periodFilter === "sprint" ? (
                <>
                  <th className="py-3 pr-3 text-right font-medium">
                    {previous ? "Current sprint" : "Completed / Committed"}
                  </th>
                  {previous ? (
                    <>
                      <th className="py-3 pr-3 text-right font-medium">Previous sprint</th>
                      <th className="py-3 pr-3 text-right font-medium">Δ pts</th>
                    </>
                  ) : null}
                </>
              ) : selectedMonthData ? (
                <>
                  <th className="py-3 pr-3 text-right font-medium">Completed / Committed</th>
                  <th className="py-3 pr-3 text-right font-medium">Velocity</th>
                  <th className="py-3 pr-3 text-right font-medium">Tickets</th>
                  <th className="py-3 pr-3 text-right font-medium">Logged</th>
                </>
              ) : (
                <>
                  <th className="py-3 pr-4 text-right font-medium">
                    {monthlyData?.previous.meta.shortLabel ?? "Prev Month"} (Pts)
                  </th>
                  <th className="py-3 pr-4 text-right font-medium">
                    {monthlyData?.current.meta.shortLabel ?? "Cur Month"} (Pts)
                  </th>
                  <th className="py-3 pr-4 text-right font-medium">MoM Delta</th>
                  <th className="py-3 pr-3 text-right font-medium">Hours</th>
                </>
              )}
              {exclusion ? (
                <th className="py-3">
                  <span className="sr-only">Actions</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {displayedRows.map((row) => {
              const isSelected = memberFilter === row.id;
              return (
                <tr
                  key={row.id}
                  onClick={() => setMemberFilter(isSelected ? "all" : row.id)}
                  className={`cursor-pointer transition-colors hover:bg-muted/30 ${
                    isSelected ? "bg-primary/10 font-semibold" : ""
                  }`}
                >
                  <td className="py-3 pr-3 font-medium text-foreground">
                    <div className="flex items-center gap-1.5">
                      {isSelected && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                      <span>{row.name}</span>
                    </div>
                  </td>
                  {periodFilter === "sprint" ? (
                    <>
                      <td className="py-3 pr-3 text-right tabular-nums text-muted-foreground">
                        {row.curSprintCompleted ?? 0}/{row.curSprintCommitted ?? 0} pts ·{" "}
                        {row.curSprintDone ?? 0}/{row.curSprintTotal ?? 0} tickets ·{" "}
                        {formatHours(row.curSprintLogged ?? 0)} logged
                      </td>
                      {previous ? (
                        <>
                          <td className="py-3 pr-3 text-right tabular-nums text-muted-foreground">
                            {row.prevSprintCompleted !== undefined
                              ? `${row.prevSprintCompleted}/${row.prevSprintCommitted} pts · ${row.prevSprintDone}/${row.prevSprintTotal} tickets · ${formatHours(row.prevSprintLogged ?? 0)} logged`
                              : "—"}
                          </td>
                          <td className="py-3 pr-3 text-right tabular-nums">
                            <TeamDeltaBadge
                              current={row.curSprintCompleted ?? 0}
                              previous={row.prevSprintCompleted ?? 0}
                            />
                          </td>
                        </>
                      ) : null}
                    </>
                  ) : selectedMonthData ? (
                    <>
                      <td className="py-3 pr-3 text-right tabular-nums text-muted-foreground">
                        <strong className="text-foreground">{row.curMonthCompleted ?? 0}</strong> /{" "}
                        {row.curMonthCommitted ?? 0} pts
                      </td>
                      <td className="py-3 pr-3 text-right tabular-nums text-muted-foreground">
                        {(row.curMonthCommitted ?? 0) > 0
                          ? `${Math.round(((row.curMonthCompleted ?? 0) / (row.curMonthCommitted ?? 1)) * 1000) / 10}%`
                          : "0%"}
                      </td>
                      <td className="py-3 pr-3 text-right tabular-nums text-muted-foreground">
                        {row.curMonthDone ?? 0} / {row.curMonthTotal ?? 0} tickets
                      </td>
                      <td className="py-3 pr-3 text-right tabular-nums text-muted-foreground">
                        {formatHours(row.curMonthLogged ?? 0)}
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="py-3 pr-4 text-right tabular-nums text-muted-foreground">
                        <strong className="text-foreground">{row.prevMonthCompleted ?? 0}</strong> /{" "}
                        {row.prevMonthCommitted ?? 0} pts
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums text-muted-foreground">
                        <strong className="text-foreground">{row.curMonthCompleted ?? 0}</strong> /{" "}
                        {row.curMonthCommitted ?? 0} pts
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums font-medium">
                        {(() => {
                          const delta =
                            Math.round(
                              ((row.curMonthCompleted ?? 0) - (row.prevMonthCompleted ?? 0)) * 10,
                            ) / 10;
                          return (
                            <span
                              className={
                                delta > 0
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : delta < 0
                                    ? "text-rose-600 dark:text-rose-400"
                                    : "text-muted-foreground"
                              }
                            >
                              {delta > 0 ? "▲ +" : delta < 0 ? "▼ " : "±"}
                              {delta} pts
                            </span>
                          );
                        })()}
                      </td>
                      <td className="py-3 pr-3 text-right tabular-nums text-muted-foreground">
                        {formatHours(row.prevMonthLogged ?? 0)} / {formatHours(row.curMonthLogged ?? 0)}
                      </td>
                    </>
                  )}
                  {exclusion ? (
                    <td className="py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <HideMemberButton
                        accountId={row.id}
                        name={row.name}
                        exclusion={exclusion}
                      />
                    </td>
                  ) : null}
                </tr>
              );
            })}
            {displayedRows.length === 0 ? (
              <tr>
                <td
                  className="py-6 text-center text-muted-foreground"
                  colSpan={6}
                >
                  No team members matching your filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* Additional Detail depending on Period */}
      {periodFilter === "sprint" && previous ? (
        <>
          <div className="mt-8 border-t border-border pt-6">
            <h3 className="text-xs font-semibold text-foreground">
              This sprint vs previous sprint
            </h3>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {report.sprint.name} vs {previous.sprint.name}
            </p>
            <div className="mt-4">
              <SprintComparisonChart current={report.totals} previous={previous.totals} />
            </div>
            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[420px] text-left text-xs">
                <thead className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Metric</th>
                    <th className="py-2 pr-3 text-right font-medium">Current</th>
                    <th className="py-2 pr-3 text-right font-medium">Previous</th>
                    <th className="py-2 text-right font-medium">Δ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(
                    [
                      ["Committed points", report.totals.committedPoints, previous.totals.committedPoints, "pts"],
                      ["Completed points", report.totals.completedPoints, previous.totals.completedPoints, "pts"],
                      ["Completion %", report.totals.completionPct, previous.totals.completionPct, "%"],
                      ["Carry-forward tickets", report.totals.carryForwardCount, previous.totals.carryForwardCount, ""],
                    ] as const
                  ).map(([label, curr, prev, unit]) => (
                    <tr key={label}>
                      <td className="py-2 pr-3 text-muted-foreground">{label}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-foreground">
                        {curr}
                        {unit ? ` ${unit}` : ""}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                        {prev}
                        {unit ? ` ${unit}` : ""}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        <TeamDeltaBadge current={curr} previous={prev} unit={unit} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-8 border-t border-border pt-6">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xs font-semibold text-foreground">
                Previous sprint details
              </h3>
              <span className="preview-label">{previous.sprint.name}</span>
            </div>
            <div className="mt-4 grid gap-6 sm:grid-cols-2">
              <StatusBreakdownChart totals={previous.totals} />
              <div className="grid grid-cols-2 gap-4 text-xs sm:border-l sm:border-border sm:pl-6">
                <div>
                  <div className="text-[11px] text-muted-foreground">Completion</div>
                  <div className="mt-1 tabular-nums text-lg font-semibold">
                    {previous.totals.completionPct}%
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">Carry-forward</div>
                  <div className="mt-1 tabular-nums text-lg font-semibold">
                    {previous.totals.carryForwardCount}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">Committed</div>
                  <div className="mt-1 tabular-nums text-sm font-semibold">
                    {previous.totals.committedPoints} pts
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">Completed</div>
                  <div className="mt-1 tabular-nums text-sm font-semibold">
                    {previous.totals.completedPoints} pts
                  </div>
                </div>
              </div>
            </div>
            <h3 className="mt-8 text-xs font-semibold text-foreground">
              Member-wise comparison
            </h3>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Each active team member's {previous.sprint.name} results against{" "}
              {report.sprint.name}
            </p>
            <MemberComparisonTable
              report={report}
              previous={previous}
              exclusion={exclusion}
              filterMemberId={memberFilter !== "all" ? memberFilter : undefined}
            />
          </div>
        </>
      ) : periodFilter !== "sprint" && monthlyData ? (
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
          <div>
            <h3 className="text-xs font-semibold text-foreground">
              Month-wise detailed tickets & breakdown
            </h3>
            <p className="mt-1 text-[11px] text-muted-foreground">
              View individual ticket items, status buckets, and carry-forward for {activeMetrics.name}.
            </p>
          </div>
          {onViewChange && (
            <button
              type="button"
              onClick={() => onViewChange("monthly")}
              className="secondary-button text-xs font-medium"
            >
              Open in Month-wise tracking →
            </button>
          )}
        </div>
      ) : !previous ? (
        <div className="mt-8 border-t border-border pt-6 text-[11px] text-muted-foreground">
          No previous sprint synced yet — comparison and previous-sprint
          details will appear after this board has a second sprint to
          compare against.
        </div>
      ) : null}

      <ExcludedMembersList exclusion={exclusion} />
    </section>
  );
}

function ReportSection({
  view,
  report,
  previous,
  exclusion,
  onViewChange,
}: {
  view: ReportView;
  report: SprintReport;
  previous?: SprintReport | null;
  exclusion?: MemberExclusion;
  onViewChange?: (view: ReportView) => void;
}) {
  if (view === "monthly") {
    return <MonthlyTrackingSection boardId={report.sprint.boardId} />;
  }

  if (view === "quarterly") {
    return <QuarterlyTrackingSection boardId={report.sprint.boardId} />;
  }

  if (view === "tickets") {
    return <TicketDetails report={report} />;
  }

  if (view === "team") {
    return (
      <TeamPerformanceSection
        report={report}
        previous={previous}
        exclusion={exclusion}
        onViewChange={onViewChange}
      />
    );
  }

  if (view === "work-log") {
    return <WorkLogSection report={report} previous={previous} />;
  }

  if (view === "points") {
    return (
      <StoryPointsSection
        report={report}
        previous={previous}
        onViewChange={onViewChange}
      />
    );
  }

  if (view === "carry-forward") {
    return (
      <section className="surface p-5 sm:p-6" aria-labelledby="carry-heading">
        <div className="flex items-center justify-between">
          <h2 id="carry-heading" className="text-sm font-semibold">
            Carry-forward items
          </h2>
          <span className="preview-label">{report.sprint.name}</span>
        </div>
        <div className="mt-8 flex items-baseline gap-3">
          <span className="tabular-nums text-5xl font-semibold tracking-[-0.06em]">
            {report.totals.carryForwardCount}
          </span>
          <span className="text-sm text-muted-foreground">
            ticket{report.totals.carryForwardCount === 1 ? "" : "s"} not yet
            done
          </span>
        </div>
        <div className="mt-6 divide-y divide-border border-t border-border text-xs">
          {report.carryForward.map((issue) => (
            <div
              key={issue.key}
              className="flex items-center justify-between gap-3 py-3"
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-foreground">
                  {issue.key} · {issue.summary}
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {issue.status} · {issue.assigneeName}
                  {issue.loggedHours > 0 ? ` · ${formatHours(issue.loggedHours)} logged` : ""}
                </div>
              </div>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {issue.storyPoints ?? "—"} pts
              </span>
            </div>
          ))}
          {report.carryForward.length === 0 ? (
            <div className="py-3 text-muted-foreground">
              Everything in this sprint is done.
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <OverviewSection
      report={report}
      previous={previous}
      onViewChange={onViewChange}
    />
  );
}

function ReportDashboard({
  view,
  onViewChange,
  report,
  previous,
  exclusion,
}: {
  view: ReportView;
  onViewChange: (view: ReportView) => void;
  report: SprintReport;
  previous?: SprintReport | null;
  exclusion?: MemberExclusion;
}) {
  const remainingText = `${report.totals.remainingPoints}`;
  return (
    <div className="grid gap-4 xl:grid-cols-[1.45fr_0.9fr]">
      <section className="surface p-5 sm:p-6" aria-labelledby="summary-heading">
        <div className="flex items-center justify-between gap-3">
          <h2 id="summary-heading" className="text-sm font-semibold">
            Management summary
          </h2>
          <span className="preview-label">{report.sprint.name}</span>
        </div>
        <p className="mt-5 max-w-2xl text-[15px] leading-7 tracking-[-0.015em] text-foreground/85">
          The team committed{" "}
          <strong className="font-semibold text-foreground">
            {report.totals.committedPoints} story points
          </strong>{" "}
          and completed{" "}
          <strong className="font-semibold text-foreground">
            {report.totals.completedPoints}
          </strong>
          . {report.totals.inProgressCount} ticket
          {report.totals.inProgressCount === 1 ? " is" : "s are"} still in
          progress and {report.totals.todoCount} remain
          {report.totals.todoCount === 1 ? "s" : ""} in To Do.{" "}
          <strong className="font-semibold text-foreground">
            {report.totals.carryForwardCount} ticket
            {report.totals.carryForwardCount === 1 ? "" : "s"}
          </strong>{" "}
          {report.totals.carryForwardCount === 1 ? "is" : "are"} being carried
          forward to the next sprint.{" "}
          <strong className="font-semibold text-foreground">
            {formatHours(report.totals.loggedHours)}
          </strong>{" "}
          {report.totals.worklogEntryCount > 0
            ? `logged across ${report.totals.worklogEntryCount} work log entr${report.totals.worklogEntryCount === 1 ? "y" : "ies"}.`
            : "logged so far."}
        </p>
      </section>
      <section
        className="surface flex flex-col p-5 sm:p-6"
        aria-labelledby="completion-heading"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="completion-heading" className="text-sm font-semibold">
            Commitment
          </h2>
          <span className="text-[11px] text-muted-foreground">
            {report.sprint.name}
          </span>
        </div>
        <div className="mt-7 flex items-end justify-between gap-3">
          <div>
            <div className="tabular-nums text-[42px] font-semibold leading-none tracking-[-0.065em]">
              {report.totals.completionPct}
              <span className="text-2xl">%</span>
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              of planned story points completed
            </div>
          </div>
          <div className="text-right text-[11px] leading-5 text-muted-foreground">
            <span className="font-semibold text-foreground">
              {report.totals.completedPoints} pts
            </span>
            <br />
            of {report.totals.committedPoints} committed
          </div>
        </div>
        <div className="progress-track mt-6">
          <span
            className="progress-fill"
            style={{ width: `${Math.min(100, report.totals.completionPct)}%` }}
          />
        </div>
        <div className="mt-auto flex justify-between pt-5 text-[11px] text-muted-foreground">
          <span>
            Completed{" "}
            <strong className="font-medium text-foreground">
              {report.totals.completedPoints}
            </strong>
          </span>
          <span>
            Remaining{" "}
            <strong className="font-medium text-foreground">
              {remainingText}
            </strong>
          </span>
        </div>
      </section>
      <section className="xl:col-span-2" aria-labelledby="report-heading">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 id="report-heading" className="text-sm font-semibold">
            Sprint report
          </h2>
          <div
            className="flex gap-1 overflow-x-auto"
            role="tablist"
            aria-label="Sprint report sections"
          >
            {reportViews.map((item) => (
              <button
                key={item.id}
                role="tab"
                aria-selected={view === item.id}
                className={`report-tab ${view === item.id ? "report-tab-active" : ""}`}
                onClick={() => onViewChange(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <ReportSection
          view={view}
          report={report}
          previous={previous}
          exclusion={exclusion}
        />
      </section>
    </div>
  );
}

function ConnectPrompt({ title, body, ctaLabel, ctaHref, onCta, ctaPending }: {
  title: string;
  body: string;
  ctaLabel: string;
  ctaHref?: string;
  onCta?: () => void;
  ctaPending?: boolean;
}) {
  return (
    <section className="surface flex flex-col items-start gap-3 p-8 text-left">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="max-w-md text-[13px] leading-6 text-muted-foreground">
        {body}
      </p>
      {ctaHref ? (
        <a href={ctaHref} className="export-button">
          {ctaLabel}
        </a>
      ) : (
        <button
          className="export-button disabled:opacity-60"
          onClick={onCta}
          disabled={ctaPending}
        >
          {ctaPending ? "Working…" : ctaLabel}
        </button>
      )}
    </section>
  );
}

const JIRA_SECRET_FIELDS = [
  {
    key: "JIRA_BASE_URL",
    label: "Jira site URL",
    type: "url",
    placeholder: "https://yourteam.atlassian.net",
  },
  {
    key: "JIRA_USER_EMAIL",
    label: "Account email",
    type: "email",
    placeholder: "you@company.com",
  },
  {
    key: "JIRA_API_TOKEN",
    label: "API token",
    type: "password",
    placeholder: "Paste your Atlassian API token",
  },
] as const;

// Saves straight to the shared secrets store the exact three keys
// server/plugins/register-secrets.ts registers — bypassing the generic
// Settings "Add key" dialog, where a free-typed name (e.g. a descriptive
// label instead of the exact key name) silently creates an unrelated ad-hoc
// key instead of filling these in.
function JiraCredentialsForm({ onSaved }: { onSaved: () => void }) {
  const [values, setValues] = useState({
    JIRA_BASE_URL: "",
    JIRA_USER_EMAIL: "",
    JIRA_API_TOKEN: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      for (const field of JIRA_SECRET_FIELDS) {
        const res = await fetch(`/_agent-native/secrets/${field.key}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: values[field.key] }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}) as { error?: string });
          throw new Error(body.error || `Failed to save ${field.label}.`);
        }
      }
      onSaved();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save Jira credentials.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="surface flex flex-col gap-4 p-8 text-left">
      <div>
        <h2 className="text-sm font-semibold">Add your Jira API key</h2>
        <p className="mt-2 max-w-md text-[13px] leading-6 text-muted-foreground">
          Sprintline reads sprints, issues, and story points from your Jira
          Cloud board. Create a token at{" "}
          <a
            href="https://id.atlassian.com/manage-profile/security/api-tokens"
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            id.atlassian.com
          </a>
          .
        </p>
      </div>
      <form onSubmit={handleSubmit} className="flex max-w-sm flex-col gap-3">
        {JIRA_SECRET_FIELDS.map((field) => (
          <label
            key={field.key}
            className="flex flex-col gap-1 text-xs font-medium text-foreground"
          >
            {field.label}
            <input
              required
              type={field.type}
              placeholder={field.placeholder}
              value={values[field.key]}
              onChange={(e) =>
                setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
              }
              className="rounded-md border border-border bg-background px-3 py-2 text-sm font-normal text-foreground"
            />
          </label>
        ))}
        {error ? (
          <p className="text-xs text-[hsl(var(--destructive))]">{error}</p>
        ) : null}
        <button
          type="submit"
          className="export-button self-start disabled:opacity-60"
          disabled={saving}
        >
          {saving ? "Saving…" : "Save & connect"}
        </button>
      </form>
    </section>
  );
}

function BoardPicker({
  configuredBoardIds,
  onSelect,
  onCancel,
  pending,
}: {
  configuredBoardIds: string[];
  onSelect: (boardId: string) => void;
  onCancel?: () => void;
  pending: boolean;
}) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  // Debounce the Jira-side name search so typing doesn't fire a request per key.
  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);
  const boards = useActionQuery("list-jira-boards", search ? { name: search } : {});
  const available = (boards.data ?? []).filter(
    (b) => !configuredBoardIds.includes(b.id),
  );

  return (
    <section className="surface flex flex-col gap-3 p-8 text-left">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">
            {configuredBoardIds.length > 0 ? "Add a board" : "Choose a board"}
          </h2>
          <p className="mt-2 max-w-md text-[13px] leading-6 text-muted-foreground">
            Each board is one team. Add every board you want to report on and
            switch between them at the top of the report.
          </p>
        </div>
        {onCancel ? (
          <button type="button" className="secondary-button" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search boards by name"
        aria-label="Search boards by name"
        className="mt-1 max-w-sm rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="mt-1 flex max-h-[420px] flex-col gap-2 overflow-y-auto">
        {available.map((board) => (
          <button
            key={board.id}
            className="secondary-button justify-start"
            disabled={pending}
            onClick={() => onSelect(board.id)}
          >
            {board.name}
          </button>
        ))}
        {boards.isError ? (
          <p className="text-xs text-destructive">
            {actionErrorMessage(boards.error) ?? "Couldn't load boards."}
          </p>
        ) : boards.isLoading ? (
          <p className="text-xs text-muted-foreground">Loading boards…</p>
        ) : available.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {search ? `No boards match "${search}".` : "No more boards found on this Jira site."}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function BoardSwitcher({
  boards,
  selectedBoardId,
  onSelect,
  onAdd,
  onRemove,
  removing,
}: {
  boards: { boardId: string; boardName: string }[];
  selectedBoardId: string;
  onSelect: (boardId: string) => void;
  onAdd: () => void;
  onRemove: (boardId: string) => void;
  removing: boolean;
}) {
  const selected = boards.find((b) => b.boardId === selectedBoardId);
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div
        className="flex min-w-0 gap-1 overflow-x-auto"
        role="tablist"
        aria-label="Boards"
      >
        {boards.map((b) => (
          <button
            key={b.boardId}
            role="tab"
            aria-selected={b.boardId === selectedBoardId}
            className={`report-tab whitespace-nowrap ${b.boardId === selectedBoardId ? "report-tab-active" : ""}`}
            onClick={() => onSelect(b.boardId)}
          >
            {b.boardName}
          </button>
        ))}
        <button type="button" className="report-tab whitespace-nowrap" onClick={onAdd}>
          + Add board
        </button>
      </div>
      {selected ? (
        <button
          type="button"
          className="text-[11px] text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50"
          disabled={removing}
          onClick={() => {
            if (window.confirm(`Stop reporting on "${selected.boardName}"? Its synced data is removed from this app (nothing changes in Jira).`)) {
              onRemove(selected.boardId);
            }
          }}
        >
          {removing ? "Removing…" : "Remove board"}
        </button>
      ) : null}
    </div>
  );
}

function ReportsPage({
  view,
  onViewChange,
  boardId,
  onBoardChange,
}: {
  view: ReportView;
  onViewChange: (view: ReportView) => void;
  boardId: string | null;
  onBoardChange: (boardId: string | null) => void;
}) {
  const connection = useActionQuery("get-jira-connection", {});
  const connected = connection.data?.connected ?? false;
  const configuredBoards = connection.data?.boards ?? [];
  const board = configuredBoards.find((b) => b.boardId === boardId) ?? null;
  const [adding, setAdding] = useState(false);

  const setBoard = useActionMutation("set-jira-board", {
    onSuccess: (_config, variables) => {
      setAdding(false);
      onBoardChange(variables.boardId);
      void connection.refetch();
    },
  });
  const removeBoard = useActionMutation("remove-jira-board", {
    onSuccess: (config) => {
      onBoardChange(config.selectedBoardId);
      void connection.refetch();
    },
  });
  // Switching is instant in the UI; persisting the choice (so the agent and
  // the next visit default to it) happens in the background.
  const selectBoard = (id: string) => {
    onBoardChange(id);
    setBoard.mutate({ boardId: id });
  };

  const comparison = useActionQuery(
    "get-sprint-comparison",
    board ? { boardId: board.boardId } : {},
    { enabled: connected && Boolean(board), retry: false },
  );
  const sync = useActionMutation("sync-jira-sprint-data", {
    onSuccess: () => comparison.refetch(),
  });
  const excludedMembers = useActionQuery(
    "list-excluded-members",
    {},
    { enabled: connected && Boolean(board) },
  );
  const setExclusion = useActionMutation("set-member-exclusion", {
    onSuccess: () => {
      void excludedMembers.refetch();
      void comparison.refetch();
    },
  });
  const exclusion: MemberExclusion = {
    members: excludedMembers.data?.members ?? [],
    onExclude: (accountId) =>
      setExclusion.mutate({ accountIds: [accountId], excluded: true }),
    onRestore: (accountId) =>
      setExclusion.mutate({ accountIds: [accountId], excluded: false }),
    pending: setExclusion.isPending,
  };

  const notSynced =
    comparison.isError &&
    actionErrorMessage(comparison.error)?.includes("No sprint has been synced yet");

  let body: React.ReactNode;
  if (connection.isLoading) {
    body = (
      <div className="surface p-8 text-sm text-muted-foreground">
        Loading…
      </div>
    );
  } else if (!connected) {
    body = <JiraCredentialsForm onSaved={() => connection.refetch()} />;
  } else if (!board || adding) {
    body = (
      <BoardPicker
        configuredBoardIds={configuredBoards.map((b) => b.boardId)}
        pending={setBoard.isPending}
        onSelect={(id) => setBoard.mutate({ boardId: id })}
        onCancel={board ? () => setAdding(false) : undefined}
      />
    );
  } else if (notSynced) {
    body = (
      <ConnectPrompt
        title="Sync your first sprint"
        body={`"${board.boardName}" hasn't been synced yet. Sync now to pull its current and previous sprint's tickets and story points.`}
        ctaLabel="Sync now"
        onCta={() => sync.mutate({ boardId: board.boardId })}
        ctaPending={sync.isPending}
      />
    );
  } else if (comparison.data) {
    body = (
      <>
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-[25px] font-semibold tracking-[-0.055em] sm:text-[29px]">
                {comparison.data.current.sprint.name}
              </h1>
              <span className="preview-label">
                {comparison.data.current.sprint.state}
              </span>
            </div>
            <div className="mt-1.5 text-xs text-muted-foreground">
              Sprint report
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              className="secondary-button disabled:opacity-60"
              onClick={() => sync.mutate({ boardId: board.boardId })}
              disabled={sync.isPending}
            >
              {sync.isPending ? "Syncing…" : "Sync now"}
            </button>
          </div>
        </div>
        <ReportDashboard
          view={view}
          onViewChange={onViewChange}
          report={comparison.data.current}
          previous={comparison.data.previous}
          exclusion={exclusion}
        />
      </>
    );
  } else if (comparison.isError) {
    // Any failure other than "not synced" must surface — otherwise the page
    // would sit on the loading state forever.
    body = (
      <ConnectPrompt
        title="Couldn't load the sprint report"
        body={actionErrorMessage(comparison.error) ?? "The report request failed."}
        ctaLabel={comparison.isFetching ? "Retrying…" : "Retry"}
        onCta={() => comparison.refetch()}
        ctaPending={comparison.isFetching}
      />
    );
  } else {
    body = (
      <div className="surface p-8 text-sm text-muted-foreground">
        Loading sprint report…
      </div>
    );
  }

  const actionError = [
    sync.isError ? `Sync failed: ${actionErrorMessage(sync.error) ?? "unknown error"}` : null,
    setBoard.isError ? `Board change failed: ${actionErrorMessage(setBoard.error) ?? "unknown error"}` : null,
    removeBoard.isError ? `Removing board failed: ${actionErrorMessage(removeBoard.error) ?? "unknown error"}` : null,
    setExclusion.isError ? `Updating excluded members failed: ${actionErrorMessage(setExclusion.error) ?? "unknown error"}` : null,
  ].filter(Boolean);

  return (
    <>
      {board && !adding ? (
        <BoardSwitcher
          boards={configuredBoards}
          selectedBoardId={board.boardId}
          onSelect={selectBoard}
          onAdd={() => setAdding(true)}
          onRemove={(id) => removeBoard.mutate({ boardId: id })}
          removing={removeBoard.isPending}
        />
      ) : null}
      {actionError.length > 0 ? (
        <div
          role="alert"
          className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-xs text-destructive"
        >
          {actionError.map((msg) => (
            <p key={msg}>{msg}</p>
          ))}
        </div>
      ) : null}
      {body}
    </>
  );
}

function Automation({
  connected,
  boardConfigured,
  onNavigateToReports,
}: {
  connected: boolean;
  boardConfigured: boolean;
  onNavigateToReports: () => void;
}) {
  const ready = connected && boardConfigured;
  return (
    <div className="max-w-[940px] space-y-4">
      <section
        className="surface p-5 sm:p-6"
        aria-labelledby="automation-heading"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2
              id="automation-heading"
              className="text-base font-semibold tracking-[-0.025em]"
            >
              Sprint reporting
            </h2>
            <div className="mt-1.5 text-xs text-muted-foreground">
              {ready
                ? "Ready · schedule a recurring report from Settings → Automations"
                : "Paused · Jira connection required"}
            </div>
          </div>
          <span className="paused-label">
            <span className="status-dot" data-state={ready ? "connected" : "disconnected"} />
            {ready ? "Ready to schedule" : "Not active"}
          </span>
        </div>
        <div className="mt-6 flex flex-col gap-5 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-lg text-[11px] leading-5 text-muted-foreground">
            Recurring sprint reports are scheduled from the shared Automations
            page: pick "at sprint end" or "daily", and the agent runs
            sync-jira-sprint-data + get-sprint-report on that cadence and
            delivers the result.
          </div>
          {ready ? (
            <a href={buildSettingsRoute("automations")} className="export-button">
              Open Automations
            </a>
          ) : (
            <button onClick={onNavigateToReports} className="secondary-button">
              Add Jira API key first
            </button>
          )}
        </div>
      </section>
      <section
        className="surface p-5 sm:p-6"
        aria-labelledby="workflow-heading"
      >
        <div className="flex items-center justify-between gap-4">
          <h2 id="workflow-heading" className="text-sm font-semibold">
            How the scheduled report runs
          </h2>
          <span className="preview-label">4 steps</span>
        </div>
        <ol className="workflow-list mt-5">
          <li>
            <span className="workflow-number">01</span>
            <div>
              <div className="text-xs font-medium">Fetch sprint + issues</div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                sync-jira-sprint-data · Jira Cloud
              </div>
            </div>
          </li>
          <li>
            <span className="workflow-number">02</span>
            <div>
              <div className="text-xs font-medium">Calculate delivery</div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                get-sprint-report · story points, completion, carry-forward
              </div>
            </div>
          </li>
          <li>
            <span className="workflow-number">03</span>
            <div>
              <div className="text-xs font-medium">Build the report</div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                Management summary + team detail
              </div>
            </div>
          </li>
          <li>
            <span className="workflow-number">04</span>
            <div>
              <div className="text-xs font-medium">Deliver report</div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                Notification, configured in Settings → Automations
              </div>
            </div>
          </li>
        </ol>
      </section>
      <details className="connection-details">
        <summary>Jira Cloud connection requirements</summary>
        <div className="mt-3 space-y-2 text-xs leading-5 text-muted-foreground">
          <p>
            Add a Jira site URL, account email, and API token in Settings →
            API keys before reports can be fetched or scheduled.
          </p>
          <p className="font-mono text-[10px]">
            id.atlassian.com/manage-profile/security/api-tokens
          </p>
        </div>
      </details>
    </div>
  );
}

export function meta() {
  return [
    { title: `${APP_TITLE} — Sprint reporting` },
    { name: "description", content: "Sprint reporting workbench" },
  ];
}

export default function HomeRoute() {
  const [page, setPage] = useState<Page>("reports");
  const [view, setView] = useState<ReportView>("overview");
  const connection = useActionQuery("get-jira-connection", {});
  const connected = connection.data?.connected ?? false;
  const boardConfigured = (connection.data?.boards.length ?? 0) > 0;
  // The board on screen: the user's pick this session, else the persisted
  // selection.
  const [pickedBoardId, setPickedBoardId] = useState<string | null>(null);
  const boardId = pickedBoardId ?? connection.data?.selectedBoardId ?? null;
  const boardName =
    connection.data?.boards.find((b) => b.boardId === boardId)?.boardName ?? null;

  // Context awareness: let the agent see which page/report tab/board the user
  // has open (view-screen reads this back). Not part of `navigation` — this
  // SPA doesn't use distinct routes per tab.
  useEffect(() => {
    writeClientAppState("sprint-reporting-screen", {
      page,
      view,
      boardId,
      boardName,
    }).catch(() => {});
  }, [page, view, boardId, boardName]);

  // Support programmatic navigation (e.g. from agent commands or deep links)
  useEffect(() => {
    let active = true;
    const interval = setInterval(async () => {
      try {
        const nav = await readClientAppState<{ view?: string; path?: string }>("navigate");
        if (nav?.view && active) {
          if (nav.view === "monthly") {
            setPage("reports");
            setView("monthly");
          } else if (nav.view === "automation") {
            setPage("automation");
          } else if (reportViews.some((r) => r.id === nav.view)) {
            setPage("reports");
            setView(nav.view as ReportView);
          }
        }
      } catch {}
    }, 600);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground md:flex-row">
      <Sidebar
        page={page}
        onNavigate={setPage}
        connected={connected}
        siteLabel={connection.data?.siteLabel ?? null}
        currentView={view}
        onViewChange={setView}
      />
      <main className="min-w-0 flex-1">
        <header className="flex min-h-[58px] items-center justify-end border-b border-border bg-card/75 px-5 sm:px-8">
          {page === "reports" ? (
            <div className="flex items-center gap-3">
              <span className="hidden text-[11px] text-muted-foreground sm:inline">
                Jira Cloud
              </span>
              <ExportButton enabled={connected && Boolean(boardId)} boardId={boardId} />
            </div>
          ) : null}
        </header>
        <div className="mx-auto max-w-[1240px] px-4 pb-10 pt-7 sm:px-8 sm:pt-9">
          {page === "reports" ? (
            <ReportsPage
              view={view}
              onViewChange={setView}
              boardId={boardId}
              onBoardChange={setPickedBoardId}
            />
          ) : (
            <>
              <div className="mb-6">
                <h1 className="text-[25px] font-semibold tracking-[-0.055em] sm:text-[29px]">
                  Automation
                </h1>
                <div className="mt-1.5 text-xs text-muted-foreground">
                  Sprint reporting
                </div>
              </div>
              <Automation
                connected={connected}
                boardConfigured={boardConfigured}
                onNavigateToReports={() => setPage("reports")}
              />
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function ExportButton({
  enabled,
  boardId,
}: {
  enabled: boolean;
  boardId: string | null;
}) {
  const [exporting, setExporting] = useState(false);
  if (!enabled) return null;

  async function handleExport() {
    setExporting(true);
    try {
      const result = await callAction<{ filename: string; csv: string }>(
        "export-sprint-report",
        boardId ? { boardId } : {},
        { method: "GET" },
      );
      triggerCsvDownload(result.filename, result.csv);
    } finally {
      setExporting(false);
    }
  }

  return (
    <button
      onClick={handleExport}
      className="export-button disabled:opacity-60"
      disabled={exporting}
    >
      {exporting ? "Exporting…" : "Export CSV"}
    </button>
  );
}
