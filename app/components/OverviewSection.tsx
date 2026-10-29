import { useMemo, useState } from "react";
import { useActionQuery } from "@agent-native/core/client/hooks";
import type {
  ReportView,
  SprintReport,
  SprintIssueItem,
  StatusBucket,
} from "../lib/sprint-types";
import {
  formatHours,
  statusIndicatorClass,
  bucketBadgeClass,
  bucketLabel,
} from "../lib/sprint-types";

function getInitials(name: string): string {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatDateRange(start: string | null, end: string | null, complete: string | null): string {
  if (!start && !end) return "No dates set";
  const s = start ? new Date(start).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—";
  const targetEnd = complete || end;
  const e = targetEnd ? new Date(targetEnd).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";
  return `${s} – ${e}`;
}

export function OverviewSection({
  report,
  previous,
  onViewChange,
}: {
  report: SprintReport;
  previous?: SprintReport | null;
  onViewChange?: (view: ReportView) => void;
}) {
  const [memberSearch, setMemberSearch] = useState("");
  const [statusCategoryFilter, setStatusCategoryFilter] = useState<string>("all");

  const boardId = report.sprint.boardId;
  const ticketsQuery = useActionQuery(
    "list-sprint-issues",
    { boardId },
    { placeholderData: (prev: unknown) => prev },
  );

  const tickets = (ticketsQuery.data ?? []) as SprintIssueItem[];

  // Detailed bucket aggregation from tickets
  const bucketDetails = useMemo(() => {
    const buckets: Record<
      StatusBucket,
      {
        count: number;
        points: number;
        hours: number;
        description: string;
        health: string;
      }
    > = {
      deployed: {
        count: 0,
        points: 0,
        hours: 0,
        description: "Shipped & live in production",
        health: "Delivered",
      },
      completed: {
        count: 0,
        points: 0,
        hours: 0,
        description: "Accepted & marked Done",
        health: "Complete",
      },
      "in-progress": {
        count: 0,
        points: 0,
        hours: 0,
        description: "Active development or review",
        health: "In Motion",
      },
      todo: {
        count: 0,
        points: 0,
        hours: 0,
        description: "Open backlog items not started",
        health: "Pending",
      },
    };

    if (tickets.length > 0) {
      for (const t of tickets) {
        const b = t.bucket || "todo";
        if (buckets[b]) {
          buckets[b].count += 1;
          buckets[b].points += t.storyPoints ?? 0;
          buckets[b].hours += t.loggedHours ?? 0;
        }
      }
    } else {
      // Fallback to report aggregates if tickets haven't loaded yet
      buckets.deployed.count = report.statusBuckets?.deployed ?? 0;
      buckets.completed.count = report.statusBuckets?.completed ?? report.totals.doneCount;
      buckets["in-progress"].count = report.totals.inProgressCount;
      buckets.todo.count = report.totals.todoCount;

      buckets.completed.points = report.totals.completedPoints;
      buckets.deployed.points = 0;
      buckets["in-progress"].points = Math.max(0, Math.round(report.totals.remainingPoints * 0.6 * 10) / 10);
      buckets.todo.points = Math.max(0, Math.round(report.totals.remainingPoints * 0.4 * 10) / 10);
      buckets.completed.hours = report.totals.loggedHours;
    }

    // Round point numbers
    for (const k of Object.keys(buckets) as StatusBucket[]) {
      buckets[k].points = Math.round(buckets[k].points * 10) / 10;
      buckets[k].hours = Math.round(buckets[k].hours * 10) / 10;
    }

    return buckets;
  }, [tickets, report]);

  // Points by status name
  const statusPointsMap = useMemo(() => {
    const map = new Map<string, { points: number; hours: number }>();
    for (const t of tickets) {
      const existing = map.get(t.status) ?? { points: 0, hours: 0 };
      existing.points += t.storyPoints ?? 0;
      existing.hours += t.loggedHours ?? 0;
      map.set(t.status, existing);
    }
    return map;
  }, [tickets]);

  // Filtered team rows
  const filteredTeam = useMemo(() => {
    return report.team.filter((m) => {
      if (!memberSearch.trim()) return true;
      return m.assigneeName.toLowerCase().includes(memberSearch.trim().toLowerCase());
    });
  }, [report.team, memberSearch]);

  // Filtered status breakdown
  const filteredStatuses = useMemo(() => {
    if (statusCategoryFilter === "all") return report.statusBreakdown;
    return report.statusBreakdown.filter((s) => s.statusCategory === statusCategoryFilter);
  }, [report.statusBreakdown, statusCategoryFilter]);

  const totalCommitted = report.totals.committedPoints || 1;
  const totalIssues = report.totals.issueCount || 1;
  const hoursPerDeliveredPoint =
    report.totals.completedPoints > 0
      ? (report.totals.loggedHours / report.totals.completedPoints).toFixed(1)
      : "—";

  return (
    <div className="space-y-6">
      {/* Sprint Header & Meta Banner */}
      <section className="surface overflow-hidden p-5 sm:p-6" aria-labelledby="overview-header">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
          <div>
            <div className="flex items-center gap-2.5">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                  report.sprint.state === "active"
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                    : "bg-muted text-muted-foreground border border-border"
                }`}
              >
                <span className={`size-1.5 rounded-full ${report.sprint.state === "active" ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground"}`} />
                {report.sprint.state}
              </span>
              <span className="text-xs font-medium text-muted-foreground">
                {report.sprint.boardName}
              </span>
            </div>
            <h1 id="overview-header" className="mt-2 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              {report.sprint.name}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span>📅 {formatDateRange(report.sprint.startDate, report.sprint.endDate, report.sprint.completeDate)}</span>
              <span>•</span>
              <span>🔄 Synced {new Date(report.sprint.syncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          </div>

          {onViewChange && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onViewChange("points")}
                className="secondary-button"
              >
                📊 Story points deep dive
              </button>
              <button
                type="button"
                onClick={() => onViewChange("tickets")}
                className="secondary-button"
              >
                🎫 View ticket details
              </button>
            </div>
          )}
        </div>

        {report.sprint.goal ? (
          <div className="mt-4 rounded-md border border-border/80 bg-muted/40 p-3 text-xs">
            <span className="font-semibold text-foreground">🎯 Sprint Goal: </span>
            <span className="text-muted-foreground">{report.sprint.goal}</span>
          </div>
        ) : null}

        {/* Executive KPI Grid */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className="rounded-lg border border-border bg-card p-3.5 shadow-2xs">
            <div className="text-[11px] font-medium text-muted-foreground">Scope Committed</div>
            <div className="mt-1.5 text-2xl font-bold tabular-nums text-foreground">
              {report.totals.committedPoints}
              <span className="ml-1 text-xs font-normal text-muted-foreground">pts</span>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {report.totals.issueCount} total tickets
            </div>
          </div>

          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3.5 shadow-2xs">
            <div className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">Delivered Points</div>
            <div className="mt-1.5 text-2xl font-bold tabular-nums text-foreground">
              {report.totals.completedPoints}
              <span className="ml-1 text-xs font-normal text-muted-foreground">pts</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px]">
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">{report.totals.completionPct}% rate</span>
              <span className="text-muted-foreground">{report.totals.doneCount} done</span>
            </div>
          </div>

          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3.5 shadow-2xs">
            <div className="text-[11px] font-medium text-amber-600 dark:text-amber-400">In Progress (WIP)</div>
            <div className="mt-1.5 text-2xl font-bold tabular-nums text-foreground">
              {report.totals.inProgressCount}
              <span className="ml-1 text-xs font-normal text-muted-foreground">tickets</span>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {bucketDetails["in-progress"].points} pts under way
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-3.5 shadow-2xs">
            <div className="text-[11px] font-medium text-muted-foreground">To Do / Backlog</div>
            <div className="mt-1.5 text-2xl font-bold tabular-nums text-foreground">
              {report.totals.todoCount}
              <span className="ml-1 text-xs font-normal text-muted-foreground">tickets</span>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {bucketDetails.todo.points} pts unstarted
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-3.5 shadow-2xs">
            <div className="text-[11px] font-medium text-muted-foreground">Carry-Forward</div>
            <div className="mt-1.5 text-2xl font-bold tabular-nums text-foreground">
              {report.totals.carryForwardCount}
              <span className="ml-1 text-xs font-normal text-muted-foreground">tickets</span>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {report.totals.remainingPoints} pts spillover risk
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-3.5 shadow-2xs">
            <div className="text-[11px] font-medium text-muted-foreground">Logged Effort</div>
            <div className="mt-1.5 text-2xl font-bold tabular-nums text-foreground">
              {formatHours(report.totals.loggedHours)}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {hoursPerDeliveredPoint} h / delivered pt
            </div>
          </div>
        </div>
      </section>

      {/* TABLE 1: Sprint Delivery & Workflow Stage Breakdown */}
      <section className="surface overflow-hidden" aria-labelledby="stage-breakdown-heading">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 id="stage-breakdown-heading" className="text-sm font-semibold text-foreground">
              Sprint Health & Delivery Stage Breakdown
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Detailed distribution of scope, story points, and logged effort across workflow stages.
            </p>
          </div>
          <span className="preview-label">4 Workflow Stages</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="bg-muted/50 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">Delivery Stage</th>
                <th className="px-5 py-3 font-medium">Stage Status</th>
                <th className="px-5 py-3 text-right font-medium">Tickets</th>
                <th className="px-5 py-3 font-medium">Ticket Share</th>
                <th className="px-5 py-3 text-right font-medium">Story Points</th>
                <th className="px-5 py-3 font-medium">Points Share</th>
                <th className="px-5 py-3 text-right font-medium">Logged Time</th>
                <th className="px-5 py-3 text-right font-medium">Avg Pts / Ticket</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(["deployed", "completed", "in-progress", "todo"] as StatusBucket[]).map((bucket) => {
                const data = bucketDetails[bucket];
                const ticketPct = Math.round((data.count / totalIssues) * 100);
                const pointsPct = Math.round((data.points / totalCommitted) * 100);
                const avgPts = data.count > 0 ? (data.points / data.count).toFixed(1) : "—";

                return (
                  <tr key={bucket} className="hover:bg-muted/20 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <span className={`state-indicator ${bucket === "deployed" || bucket === "completed" ? "state-done" : bucket === "in-progress" ? "state-progress" : "state-todo"}`} />
                        <div>
                          <div className="font-semibold text-foreground">{bucketLabel(bucket)}</div>
                          <div className="text-[11px] text-muted-foreground">{data.description}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium ${bucketBadgeClass(bucket)}`}>
                        {data.health}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right font-semibold tabular-nums text-foreground">
                      {data.count}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full ${bucket === "deployed" ? "bg-emerald-500" : bucket === "completed" ? "bg-primary" : bucket === "in-progress" ? "bg-amber-500" : "bg-muted-foreground/40"}`}
                            style={{ width: `${Math.min(100, ticketPct)}%` }}
                          />
                        </div>
                        <span className="tabular-nums text-muted-foreground">{ticketPct}%</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-right font-semibold tabular-nums text-foreground">
                      {data.points} pts
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full ${bucket === "deployed" ? "bg-emerald-500" : bucket === "completed" ? "bg-primary" : bucket === "in-progress" ? "bg-amber-500" : "bg-muted-foreground/40"}`}
                            style={{ width: `${Math.min(100, pointsPct)}%` }}
                          />
                        </div>
                        <span className="tabular-nums text-muted-foreground">{pointsPct}%</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-muted-foreground">
                      {formatHours(data.hours)}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-muted-foreground">
                      {avgPts} pts
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-border bg-muted/40 font-semibold text-foreground">
              <tr>
                <td className="px-5 py-3">Total Scope</td>
                <td className="px-5 py-3 text-[11px] text-muted-foreground">{report.totals.completionPct}% Completed</td>
                <td className="px-5 py-3 text-right tabular-nums">{report.totals.issueCount}</td>
                <td className="px-5 py-3 text-muted-foreground">100%</td>
                <td className="px-5 py-3 text-right tabular-nums">{report.totals.committedPoints} pts</td>
                <td className="px-5 py-3 text-muted-foreground">100%</td>
                <td className="px-5 py-3 text-right tabular-nums">{formatHours(report.totals.loggedHours)}</td>
                <td className="px-5 py-3 text-right tabular-nums">
                  {(report.totals.committedPoints / totalIssues).toFixed(1)} pts
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* TABLE 2: Team Execution & Contribution Table */}
      <section className="surface overflow-hidden" aria-labelledby="team-breakdown-heading">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 id="team-breakdown-heading" className="text-sm font-semibold text-foreground">
              Team Member Contribution & Execution
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Individual scope ownership, delivered points, delivery rates, and logged effort.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder="Search member..."
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2.5 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <span className="preview-label">{report.team.length} Members</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="bg-muted/50 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">Team Member</th>
                <th className="px-5 py-3 text-right font-medium">Assigned Tickets</th>
                <th className="px-5 py-3 text-right font-medium">Completed Tickets</th>
                <th className="px-5 py-3 text-right font-medium">Committed Pts</th>
                <th className="px-5 py-3 text-right font-medium">Delivered Pts</th>
                <th className="px-5 py-3 text-right font-medium">Remaining Pts</th>
                <th className="px-5 py-3 font-medium">Delivery Rate</th>
                <th className="px-5 py-3 text-right font-medium">Logged Hours</th>
                <th className="px-5 py-3 text-right font-medium">Velocity (Pts/Hr)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredTeam.map((m) => {
                const remPoints = Math.max(0, Math.round((m.committedPoints - m.completedPoints) * 10) / 10);
                const rate = m.committedPoints > 0 ? Math.round((m.completedPoints / m.committedPoints) * 100) : 0;
                const velocity = m.loggedHours > 0 ? (m.completedPoints / m.loggedHours).toFixed(2) : "—";

                return (
                  <tr key={m.assigneeAccountId ?? m.assigneeName} className="hover:bg-muted/20 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                          {getInitials(m.assigneeName)}
                        </div>
                        <div>
                          <div className="font-semibold text-foreground">{m.assigneeName}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {m.totalCount} ticket{m.totalCount === 1 ? "" : "s"} assigned
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-right font-medium tabular-nums text-foreground">
                      {m.totalCount}
                    </td>
                    <td className="px-5 py-3.5 text-right font-medium tabular-nums text-foreground">
                      {m.doneCount}{" "}
                      <span className="text-[11px] text-muted-foreground">
                        ({Math.round((m.doneCount / (m.totalCount || 1)) * 100)}%)
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right font-medium tabular-nums text-foreground">
                      {m.committedPoints} pts
                    </td>
                    <td className="px-5 py-3.5 text-right font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                      {m.completedPoints} pts
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-muted-foreground">
                      {remPoints > 0 ? `${remPoints} pts` : "0 pts"}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full ${rate >= 80 ? "bg-emerald-500" : rate >= 50 ? "bg-amber-500" : "bg-muted-foreground/50"}`}
                            style={{ width: `${Math.min(100, rate)}%` }}
                          />
                        </div>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                            rate >= 80
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              : rate >= 50
                              ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {rate}%
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-right font-medium tabular-nums text-foreground">
                      {formatHours(m.loggedHours)}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-muted-foreground">
                      {velocity}
                    </td>
                  </tr>
                );
              })}

              {filteredTeam.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-5 py-8 text-center text-xs text-muted-foreground">
                    No team members found matching "{memberSearch}".
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot className="border-t-2 border-border bg-muted/40 font-semibold text-foreground">
              <tr>
                <td className="px-5 py-3">Team Total ({report.team.length} contributors)</td>
                <td className="px-5 py-3 text-right tabular-nums">
                  {report.team.reduce((sum, m) => sum + m.totalCount, 0)}
                </td>
                <td className="px-5 py-3 text-right tabular-nums">
                  {report.team.reduce((sum, m) => sum + m.doneCount, 0)}
                </td>
                <td className="px-5 py-3 text-right tabular-nums">{report.totals.committedPoints} pts</td>
                <td className="px-5 py-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                  {report.totals.completedPoints} pts
                </td>
                <td className="px-5 py-3 text-right tabular-nums">{report.totals.remainingPoints} pts</td>
                <td className="px-5 py-3">
                  <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                    {report.totals.completionPct}% overall
                  </span>
                </td>
                <td className="px-5 py-3 text-right tabular-nums">{formatHours(report.totals.loggedHours)}</td>
                <td className="px-5 py-3 text-right tabular-nums">
                  {report.totals.loggedHours > 0
                    ? (report.totals.completedPoints / report.totals.loggedHours).toFixed(2)
                    : "—"}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* TABLE 3: Detailed Jira Workflow Status Distribution */}
      <section className="surface overflow-hidden" aria-labelledby="status-table-heading">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 id="status-table-heading" className="text-sm font-semibold text-foreground">
              Jira Workflow Status Distribution
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Full breakdown by exact Jira workflow statuses in this sprint.
            </p>
          </div>
          <div className="flex gap-1">
            {["all", "done", "indeterminate", "new"].map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setStatusCategoryFilter(cat)}
                className={`report-tab ${statusCategoryFilter === cat ? "report-tab-active" : ""}`}
              >
                {cat === "all" ? "All Statuses" : cat === "done" ? "Done" : cat === "indeterminate" ? "In Progress" : "To Do"}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-xs">
            <thead className="bg-muted/50 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">Status Name</th>
                <th className="px-5 py-3 font-medium">Jira Category</th>
                <th className="px-5 py-3 text-right font-medium">Ticket Count</th>
                <th className="px-5 py-3 font-medium">Scope Share</th>
                <th className="px-5 py-3 text-right font-medium">Story Points</th>
                <th className="px-5 py-3 text-right font-medium">Logged Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredStatuses.map((s) => {
                const sharePct = Math.round((s.count / totalIssues) * 100);
                const ptsData = statusPointsMap.get(s.status) ?? { points: 0, hours: 0 };

                return (
                  <tr key={s.status} className="hover:bg-muted/20 transition-colors">
                    <td className="px-5 py-3 font-medium text-foreground">
                      <span className={`state-indicator ${statusIndicatorClass(s.statusCategory)}`} />
                      {s.status}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      <span className="capitalize">{s.statusCategory === "indeterminate" ? "In Progress" : s.statusCategory === "new" ? "To Do" : "Done"}</span>
                    </td>
                    <td className="px-5 py-3 text-right font-semibold tabular-nums text-foreground">
                      {s.count}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full ${statusIndicatorClass(s.statusCategory) === "state-done" ? "bg-emerald-500" : statusIndicatorClass(s.statusCategory) === "state-progress" ? "bg-amber-500" : "bg-muted-foreground/40"}`}
                            style={{ width: `${Math.min(100, sharePct)}%` }}
                          />
                        </div>
                        <span className="tabular-nums text-muted-foreground">{sharePct}%</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-foreground">
                      {Math.round(ptsData.points * 10) / 10} pts
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                      {formatHours(Math.round(ptsData.hours * 10) / 10)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
