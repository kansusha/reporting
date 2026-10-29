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

type SizeTier = "small" | "medium" | "large" | "unestimated";

export function StoryPointsSection({
  report,
  onViewChange,
}: {
  report: SprintReport;
  previous?: SprintReport | null;
  onViewChange?: (view: ReportView) => void;
}) {
  const [ticketSearch, setTicketSearch] = useState("");
  const [ticketFilter, setTicketFilter] = useState<"all" | "completed" | "in-progress" | "todo" | "unestimated">("all");
  const [sortBy, setSortBy] = useState<"points-desc" | "points-asc" | "key" | "hours-desc">("points-desc");

  const boardId = report.sprint.boardId;
  const ticketsQuery = useActionQuery(
    "list-sprint-issues",
    { boardId },
    { placeholderData: (prev: unknown) => prev },
  );

  const tickets = (ticketsQuery.data ?? []) as SprintIssueItem[];

  // Stage breakdown
  const bucketBreakdown = useMemo(() => {
    const buckets: Record<
      StatusBucket,
      { count: number; points: number; hours: number }
    > = {
      deployed: { count: 0, points: 0, hours: 0 },
      completed: { count: 0, points: 0, hours: 0 },
      "in-progress": { count: 0, points: 0, hours: 0 },
      todo: { count: 0, points: 0, hours: 0 },
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
      buckets.deployed.count = report.statusBuckets?.deployed ?? 0;
      buckets.completed.count = report.statusBuckets?.completed ?? report.totals.doneCount;
      buckets["in-progress"].count = report.totals.inProgressCount;
      buckets.todo.count = report.totals.todoCount;

      buckets.completed.points = report.totals.completedPoints;
      buckets["in-progress"].points = Math.max(0, Math.round(report.totals.remainingPoints * 0.6 * 10) / 10);
      buckets.todo.points = Math.max(0, Math.round(report.totals.remainingPoints * 0.4 * 10) / 10);
      buckets.completed.hours = report.totals.loggedHours;
    }

    for (const k of Object.keys(buckets) as StatusBucket[]) {
      buckets[k].points = Math.round(buckets[k].points * 10) / 10;
      buckets[k].hours = Math.round(buckets[k].hours * 10) / 10;
    }

    return buckets;
  }, [tickets, report]);

  // Sizing breakdown (Small: 1-2, Medium: 3-5, Large: 8+, Unestimated: 0 or null)
  const sizingMatrix = useMemo(() => {
    const matrix: Record<
      SizeTier,
      {
        label: string;
        range: string;
        count: number;
        points: number;
        doneCount: number;
        donePoints: number;
        risk: string;
        riskClass: string;
      }
    > = {
      small: {
        label: "Small",
        range: "1 – 2 pts",
        count: 0,
        points: 0,
        doneCount: 0,
        donePoints: 0,
        risk: "Low Risk",
        riskClass: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
      },
      medium: {
        label: "Medium",
        range: "3 – 5 pts",
        count: 0,
        points: 0,
        doneCount: 0,
        donePoints: 0,
        risk: "Moderate",
        riskClass: "bg-primary/10 text-primary border-primary/20",
      },
      large: {
        label: "Large / Epic",
        range: "8+ pts",
        count: 0,
        points: 0,
        doneCount: 0,
        donePoints: 0,
        risk: "Spillover Risk",
        riskClass: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
      },
      unestimated: {
        label: "Unestimated",
        range: "No pts / 0",
        count: 0,
        points: 0,
        doneCount: 0,
        donePoints: 0,
        risk: "Estimation Blindspot",
        riskClass: "bg-destructive/10 text-destructive border-destructive/20",
      },
    };

    for (const t of tickets) {
      const pts = t.storyPoints;
      const isDone = t.statusCategory === "done";

      let tier: SizeTier = "unestimated";
      if (pts != null && pts > 0) {
        if (pts <= 2) tier = "small";
        else if (pts <= 5) tier = "medium";
        else tier = "large";
      }

      matrix[tier].count += 1;
      matrix[tier].points += pts ?? 0;
      if (isDone) {
        matrix[tier].doneCount += 1;
        matrix[tier].donePoints += pts ?? 0;
      }
    }

    for (const k of Object.keys(matrix) as SizeTier[]) {
      matrix[k].points = Math.round(matrix[k].points * 10) / 10;
      matrix[k].donePoints = Math.round(matrix[k].donePoints * 10) / 10;
    }

    return matrix;
  }, [tickets]);

  // Unestimated tickets count
  const unestimatedCount = useMemo(() => {
    return tickets.filter((t) => t.storyPoints == null || t.storyPoints === 0).length;
  }, [tickets]);

  const estimatedCount = tickets.length - unestimatedCount;
  const estimationCoveragePct = tickets.length > 0 ? Math.round((estimatedCount / tickets.length) * 100) : 100;

  // Filtered & sorted tickets list
  const filteredTickets = useMemo(() => {
    let list = tickets.filter((t) => {
      // Search match
      if (ticketSearch.trim()) {
        const q = ticketSearch.trim().toLowerCase();
        const matchKey = t.key.toLowerCase().includes(q);
        const matchSummary = t.summary.toLowerCase().includes(q);
        const matchAssignee = t.assigneeName?.toLowerCase().includes(q);
        if (!matchKey && !matchSummary && !matchAssignee) return false;
      }

      // Filter pill
      if (ticketFilter === "completed") {
        return t.statusCategory === "done";
      }
      if (ticketFilter === "in-progress") {
        return t.bucket === "in-progress";
      }
      if (ticketFilter === "todo") {
        return t.bucket === "todo";
      }
      if (ticketFilter === "unestimated") {
        return t.storyPoints == null || t.storyPoints === 0;
      }
      return true;
    });

    // Sorting
    list = [...list].sort((a, b) => {
      if (sortBy === "points-desc") {
        return (b.storyPoints ?? -1) - (a.storyPoints ?? -1);
      }
      if (sortBy === "points-asc") {
        return (a.storyPoints ?? 9999) - (b.storyPoints ?? 9999);
      }
      if (sortBy === "hours-desc") {
        return (b.loggedHours ?? 0) - (a.loggedHours ?? 0);
      }
      return a.key.localeCompare(b.key);
    });

    return list;
  }, [tickets, ticketSearch, ticketFilter, sortBy]);

  const totalCommitted = report.totals.committedPoints || 1;
  const hoursPerPoint =
    report.totals.completedPoints > 0
      ? (report.totals.loggedHours / report.totals.completedPoints).toFixed(1)
      : "—";

  return (
    <div className="space-y-6">
      {/* Header & KPI Summary Cards */}
      <section className="surface p-5 sm:p-6" aria-labelledby="story-points-header">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="preview-label">{report.sprint.boardName}</span>
              <span className="text-xs text-muted-foreground">•</span>
              <span className="text-xs font-semibold text-foreground">{report.sprint.name}</span>
            </div>
            <h1 id="story-points-header" className="mt-2 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              Story Point Analytics & Estimation Breakdown
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Story point velocity, sizing distribution, stage allocation, and ticket-level estimations.
            </p>
          </div>

          {onViewChange && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onViewChange("overview")}
                className="secondary-button"
              >
                📋 Back to overview
              </button>
              <button
                type="button"
                onClick={() => onViewChange("tickets")}
                className="secondary-button"
              >
                🎫 All tickets
              </button>
            </div>
          )}
        </div>

        {/* 5 KPI Stat Cards */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <div className="rounded-lg border border-border bg-card p-4 shadow-2xs">
            <div className="text-[11px] font-medium text-muted-foreground">Total Planned Points</div>
            <div className="mt-1.5 text-2xl font-bold tabular-nums text-foreground">
              {report.totals.committedPoints}
              <span className="ml-1 text-xs font-normal text-muted-foreground">pts</span>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              Across {report.totals.issueCount} total tickets
            </div>
          </div>

          <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-4 shadow-2xs">
            <div className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">Delivered Points</div>
            <div className="mt-1.5 text-2xl font-bold tabular-nums text-foreground">
              {report.totals.completedPoints}
              <span className="ml-1 text-xs font-normal text-muted-foreground">pts</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px]">
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">{report.totals.completionPct}% completed</span>
              <span className="text-muted-foreground">{report.totals.doneCount} done</span>
            </div>
          </div>

          <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-4 shadow-2xs">
            <div className="text-[11px] font-medium text-amber-600 dark:text-amber-400">Remaining / WIP Points</div>
            <div className="mt-1.5 text-2xl font-bold tabular-nums text-foreground">
              {report.totals.remainingPoints}
              <span className="ml-1 text-xs font-normal text-muted-foreground">pts</span>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {report.totals.inProgressCount + report.totals.todoCount} uncompleted tickets
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-4 shadow-2xs">
            <div className="text-[11px] font-medium text-muted-foreground">Effort per Story Point</div>
            <div className="mt-1.5 text-2xl font-bold tabular-nums text-foreground">
              {hoursPerPoint}
              <span className="ml-1 text-xs font-normal text-muted-foreground">h / pt</span>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {formatHours(report.totals.loggedHours)} total logged
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-4 shadow-2xs">
            <div className="text-[11px] font-medium text-muted-foreground">Estimation Coverage</div>
            <div className="mt-1.5 text-2xl font-bold tabular-nums text-foreground">
              {estimationCoveragePct}%
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{estimatedCount} estimated</span>
              <span className={unestimatedCount > 0 ? "font-semibold text-amber-600 dark:text-amber-400" : ""}>
                {unestimatedCount} unestimated
              </span>
            </div>
          </div>
        </div>

        {/* Multi-segment Points Distribution Bar */}
        <div className="mt-6 rounded-lg border border-border bg-muted/30 p-4">
          <div className="flex items-center justify-between text-xs font-medium text-foreground">
            <span>Sprint Points Progress & Composition</span>
            <span className="tabular-nums font-semibold">{report.totals.completedPoints} of {report.totals.committedPoints} pts</span>
          </div>

          <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="bg-emerald-500 transition-all"
              style={{ width: `${Math.min(100, Math.round((bucketBreakdown.deployed.points / totalCommitted) * 100))}%` }}
              title={`Deployed: ${bucketBreakdown.deployed.points} pts`}
            />
            <div
              className="bg-primary transition-all"
              style={{ width: `${Math.min(100, Math.round((bucketBreakdown.completed.points / totalCommitted) * 100))}%` }}
              title={`Completed: ${bucketBreakdown.completed.points} pts`}
            />
            <div
              className="bg-amber-500 transition-all"
              style={{ width: `${Math.min(100, Math.round((bucketBreakdown["in-progress"].points / totalCommitted) * 100))}%` }}
              title={`In Progress: ${bucketBreakdown["in-progress"].points} pts`}
            />
            <div
              className="bg-muted-foreground/30 transition-all"
              style={{ width: `${Math.min(100, Math.round((bucketBreakdown.todo.points / totalCommitted) * 100))}%` }}
              title={`To Do: ${bucketBreakdown.todo.points} pts`}
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-4 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-emerald-500" />
              <span>Deployed: <strong className="font-semibold text-foreground">{bucketBreakdown.deployed.points} pts</strong> ({Math.round((bucketBreakdown.deployed.points / totalCommitted) * 100)}%)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-primary" />
              <span>Completed: <strong className="font-semibold text-foreground">{bucketBreakdown.completed.points} pts</strong> ({Math.round((bucketBreakdown.completed.points / totalCommitted) * 100)}%)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-amber-500" />
              <span>In Progress: <strong className="font-semibold text-foreground">{bucketBreakdown["in-progress"].points} pts</strong> ({Math.round((bucketBreakdown["in-progress"].points / totalCommitted) * 100)}%)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-muted-foreground/40" />
              <span>To Do: <strong className="font-semibold text-foreground">{bucketBreakdown.todo.points} pts</strong> ({Math.round((bucketBreakdown.todo.points / totalCommitted) * 100)}%)</span>
            </div>
          </div>
        </div>
      </section>

      {/* TABLE 1: Story Points by Delivery Stage */}
      <section className="surface overflow-hidden" aria-labelledby="stage-points-heading">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 id="stage-points-heading" className="text-sm font-semibold text-foreground">
              Story Points by Delivery Stage
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Allocation of story points and effort ratio across deployment and execution stages.
            </p>
          </div>
          <span className="preview-label">Stage Allocation</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-xs">
            <thead className="bg-muted/50 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">Delivery Stage</th>
                <th className="px-5 py-3 font-medium">Status Badge</th>
                <th className="px-5 py-3 text-right font-medium">Tickets</th>
                <th className="px-5 py-3 text-right font-medium">Story Points</th>
                <th className="px-5 py-3 font-medium">Share of Total Points</th>
                <th className="px-5 py-3 text-right font-medium">Logged Hours</th>
                <th className="px-5 py-3 text-right font-medium">Hours / Point</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(["deployed", "completed", "in-progress", "todo"] as StatusBucket[]).map((bucket) => {
                const b = bucketBreakdown[bucket];
                const pct = Math.round((b.points / totalCommitted) * 100);
                const hPerPt = b.points > 0 ? (b.hours / b.points).toFixed(1) : "—";

                return (
                  <tr key={bucket} className="hover:bg-muted/20 transition-colors">
                    <td className="px-5 py-3.5 font-medium text-foreground">
                      <div className="flex items-center gap-2">
                        <span className={`state-indicator ${bucket === "deployed" || bucket === "completed" ? "state-done" : bucket === "in-progress" ? "state-progress" : "state-todo"}`} />
                        <span className="font-semibold">{bucketLabel(bucket)}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium ${bucketBadgeClass(bucket)}`}>
                        {bucketLabel(bucket)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right font-semibold tabular-nums text-foreground">
                      {b.count}
                    </td>
                    <td className="px-5 py-3.5 text-right font-bold tabular-nums text-foreground">
                      {b.points} pts
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full ${bucket === "deployed" ? "bg-emerald-500" : bucket === "completed" ? "bg-primary" : bucket === "in-progress" ? "bg-amber-500" : "bg-muted-foreground/40"}`}
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                        <span className="tabular-nums font-semibold text-foreground">{pct}%</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-muted-foreground">
                      {formatHours(b.hours)}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-muted-foreground">
                      {hPerPt}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-border bg-muted/40 font-semibold text-foreground">
              <tr>
                <td className="px-5 py-3">Total</td>
                <td className="px-5 py-3 text-[11px] text-muted-foreground">{report.totals.completionPct}% Completed</td>
                <td className="px-5 py-3 text-right tabular-nums">{report.totals.issueCount}</td>
                <td className="px-5 py-3 text-right tabular-nums">{report.totals.committedPoints} pts</td>
                <td className="px-5 py-3 text-foreground">100%</td>
                <td className="px-5 py-3 text-right tabular-nums">{formatHours(report.totals.loggedHours)}</td>
                <td className="px-5 py-3 text-right tabular-nums">{hoursPerPoint}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* TABLE 2: Member-Wise Story Point Ownership & Velocity */}
      <section className="surface overflow-hidden" aria-labelledby="member-points-heading">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 id="member-points-heading" className="text-sm font-semibold text-foreground">
              Member-Wise Story Point Ownership & Velocity
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Story points committed, completed, remaining, and effort velocity per team member.
            </p>
          </div>
          <span className="preview-label">{report.team.length} Members</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="bg-muted/50 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">Team Member</th>
                <th className="px-5 py-3 text-right font-medium">Committed Points</th>
                <th className="px-5 py-3 text-right font-medium">Delivered Points</th>
                <th className="px-5 py-3 text-right font-medium">Remaining Points</th>
                <th className="px-5 py-3 font-medium">Delivery Rate</th>
                <th className="px-5 py-3 font-medium">Share of Sprint Points</th>
                <th className="px-5 py-3 text-right font-medium">Assigned Tickets</th>
                <th className="px-5 py-3 text-right font-medium">Logged Hours</th>
                <th className="px-5 py-3 text-right font-medium">Hours / Pt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {report.team.map((m) => {
                const remPoints = Math.max(0, Math.round((m.committedPoints - m.completedPoints) * 10) / 10);
                const rate = m.committedPoints > 0 ? Math.round((m.completedPoints / m.committedPoints) * 100) : 0;
                const shareOfSprint = Math.round((m.committedPoints / totalCommitted) * 100);
                const hPerDelivered = m.completedPoints > 0 ? (m.loggedHours / m.completedPoints).toFixed(1) : "—";

                return (
                  <tr key={m.assigneeAccountId ?? m.assigneeName} className="hover:bg-muted/20 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                          {getInitials(m.assigneeName)}
                        </div>
                        <div>
                          <div className="font-semibold text-foreground">{m.assigneeName}</div>
                          <div className="text-[10px] text-muted-foreground">{m.doneCount} of {m.totalCount} tickets done</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-right font-semibold tabular-nums text-foreground">
                      {m.committedPoints} pts
                    </td>
                    <td className="px-5 py-3.5 text-right font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                      {m.completedPoints} pts
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-muted-foreground">
                      {remPoints > 0 ? `${remPoints} pts` : "0 pts"}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full ${rate >= 80 ? "bg-emerald-500" : rate >= 50 ? "bg-amber-500" : "bg-muted-foreground/50"}`}
                            style={{ width: `${Math.min(100, rate)}%` }}
                          />
                        </div>
                        <span className={`text-[10px] font-semibold tabular-nums ${rate >= 80 ? "text-emerald-600 dark:text-emerald-400" : rate >= 50 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                          {rate}%
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                          <div className="h-full bg-primary" style={{ width: `${Math.min(100, shareOfSprint)}%` }} />
                        </div>
                        <span className="tabular-nums text-muted-foreground">{shareOfSprint}%</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-right font-medium tabular-nums text-foreground">
                      {m.totalCount}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-foreground">
                      {formatHours(m.loggedHours)}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-muted-foreground">
                      {hPerDelivered}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-border bg-muted/40 font-semibold text-foreground">
              <tr>
                <td className="px-5 py-3">Team Total ({report.team.length} members)</td>
                <td className="px-5 py-3 text-right tabular-nums">{report.totals.committedPoints} pts</td>
                <td className="px-5 py-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                  {report.totals.completedPoints} pts
                </td>
                <td className="px-5 py-3 text-right tabular-nums">{report.totals.remainingPoints} pts</td>
                <td className="px-5 py-3 text-emerald-600 dark:text-emerald-400">{report.totals.completionPct}%</td>
                <td className="px-5 py-3 text-foreground">100%</td>
                <td className="px-5 py-3 text-right tabular-nums">{report.totals.issueCount}</td>
                <td className="px-5 py-3 text-right tabular-nums">{formatHours(report.totals.loggedHours)}</td>
                <td className="px-5 py-3 text-right tabular-nums">{hoursPerPoint}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* TABLE 3: Story Point Sizing Distribution (Ticket Size Matrix) */}
      <section className="surface overflow-hidden" aria-labelledby="size-matrix-heading">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 id="size-matrix-heading" className="text-sm font-semibold text-foreground">
              Ticket Sizing & Complexity Matrix
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Risk analysis by story point estimate tier (Small vs Medium vs Large vs Unestimated).
            </p>
          </div>
          <span className="preview-label">Sizing Risk</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-xs">
            <thead className="bg-muted/50 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">Complexity Tier</th>
                <th className="px-5 py-3 font-medium">Point Range</th>
                <th className="px-5 py-3 text-right font-medium">Ticket Count</th>
                <th className="px-5 py-3 text-right font-medium">Total Points</th>
                <th className="px-5 py-3 text-right font-medium">Completed Tickets</th>
                <th className="px-5 py-3 text-right font-medium">Delivered Points</th>
                <th className="px-5 py-3 font-medium">Completion Rate</th>
                <th className="px-5 py-3 font-medium">Risk Assessment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(["small", "medium", "large", "unestimated"] as SizeTier[]).map((tier) => {
                const row = sizingMatrix[tier];
                const rate = row.points > 0 ? Math.round((row.donePoints / row.points) * 100) : row.count > 0 ? Math.round((row.doneCount / row.count) * 100) : 0;

                return (
                  <tr key={tier} className="hover:bg-muted/20 transition-colors">
                    <td className="px-5 py-3.5 font-semibold text-foreground">
                      {row.label}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-[11px] text-muted-foreground">
                      {row.range}
                    </td>
                    <td className="px-5 py-3.5 text-right font-semibold tabular-nums text-foreground">
                      {row.count}
                    </td>
                    <td className="px-5 py-3.5 text-right font-bold tabular-nums text-foreground">
                      {row.points > 0 ? `${row.points} pts` : "—"}
                    </td>
                    <td className="px-5 py-3.5 text-right font-medium tabular-nums text-foreground">
                      {row.doneCount}
                    </td>
                    <td className="px-5 py-3.5 text-right font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                      {row.donePoints > 0 ? `${row.donePoints} pts` : "—"}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full ${rate >= 80 ? "bg-emerald-500" : rate >= 50 ? "bg-amber-500" : "bg-muted-foreground/50"}`}
                            style={{ width: `${Math.min(100, rate)}%` }}
                          />
                        </div>
                        <span className="tabular-nums font-semibold text-muted-foreground">{rate}%</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium ${row.riskClass}`}>
                        {row.risk}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* TABLE 4: Interactive Ticket Story Points Ledger */}
      <section className="surface overflow-hidden" aria-labelledby="ledger-heading">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 id="ledger-heading" className="text-sm font-semibold text-foreground">
              Ticket Story Points Ledger & Detail Matrix
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Search and inspect individual ticket story point estimates, status, assignee, and effort.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              placeholder="Search key, summary, assignee..."
              value={ticketSearch}
              onChange={(e) => setTicketSearch(e.target.value)}
              className="h-8 w-56 rounded-md border border-input bg-background px-2.5 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="points-desc">Highest Points First</option>
              <option value="points-asc">Lowest Points First</option>
              <option value="hours-desc">Most Logged Hours</option>
              <option value="key">Key (A – Z)</option>
            </select>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex gap-1 overflow-x-auto border-b border-border px-4 py-2" role="tablist">
          {[
            { id: "all", label: "All Tickets", count: tickets.length },
            { id: "completed", label: "Completed Points", count: bucketBreakdown.completed.count + bucketBreakdown.deployed.count },
            { id: "in-progress", label: "In Progress Points", count: bucketBreakdown["in-progress"].count },
            { id: "todo", label: "To Do Points", count: bucketBreakdown.todo.count },
            { id: "unestimated", label: "Unestimated", count: unestimatedCount },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setTicketFilter(tab.id as any)}
              className={`report-tab whitespace-nowrap ${ticketFilter === tab.id ? "report-tab-active" : ""}`}
            >
              {tab.label} <span className="tabular-nums text-muted-foreground">({tab.count})</span>
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="bg-muted/50 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">Ticket</th>
                <th className="px-5 py-3 font-medium">Status & Stage</th>
                <th className="px-5 py-3 font-medium">Assignee</th>
                <th className="px-5 py-3 text-right font-medium">Story Points</th>
                <th className="px-5 py-3 text-right font-medium">Logged Hours</th>
                <th className="px-5 py-3 font-medium">Delivery Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredTickets.map((t) => {
                const isDone = t.statusCategory === "done";
                const isUnestimated = t.storyPoints == null || t.storyPoints === 0;

                return (
                  <tr key={t.key} className="hover:bg-muted/20 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="font-semibold text-foreground">{t.key}</div>
                      <div className="line-clamp-1 max-w-md text-xs text-muted-foreground" title={t.summary}>
                        {t.summary}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span className={`state-indicator ${statusIndicatorClass(t.statusCategory)}`} />
                        <span className="font-medium text-foreground">{t.status}</span>
                      </div>
                      <div className="mt-0.5">
                        <span className={`inline-flex rounded px-1.5 py-0.2 text-[9px] uppercase tracking-wider font-semibold border ${bucketBadgeClass(t.bucket)}`}>
                          {bucketLabel(t.bucket)}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground">
                      {t.assigneeName ? (
                        <div className="flex items-center gap-2">
                          <div className="flex size-5 items-center justify-center rounded-full bg-muted text-[9px] font-semibold text-muted-foreground">
                            {getInitials(t.assigneeName)}
                          </div>
                          <span>{t.assigneeName}</span>
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {isUnestimated ? (
                        <span className="inline-flex rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                          Unestimated
                        </span>
                      ) : (
                        <span
                          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold tabular-nums ${
                            isDone
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25"
                              : t.bucket === "in-progress"
                              ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/25"
                              : "bg-muted text-foreground border border-border"
                          }`}
                        >
                          {t.storyPoints} <span className="text-[10px] font-normal text-muted-foreground">pts</span>
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right font-medium tabular-nums text-muted-foreground">
                      {formatHours(t.loggedHours)}
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          isDone
                            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                            : t.bucket === "in-progress"
                            ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {isDone ? "✓ Delivered" : t.bucket === "in-progress" ? "⏳ In Flight" : "📋 Backlog"}
                      </span>
                    </td>
                  </tr>
                );
              })}

              {filteredTickets.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-xs text-muted-foreground">
                    No tickets found matching the selected filter or search query.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
