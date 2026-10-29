import { useEffect, useMemo, useState } from "react";

import { writeClientAppState } from "@agent-native/core/client/application-state";
import { useActionQuery } from "@agent-native/core/client/hooks";

import {
  LoggedHoursChart,
  QuarterlyPointsChart,
  StatusBreakdownChart,
  TeamPerformanceChart,
} from "./SprintCharts";

import type {
  QuarterlyIssueItem,
  QuarterlyMemberPerformance,
  QuarterlyQuarterData,
  QuarterlyReportData,
  StatusBucket,
} from "../lib/quarterly-report-types";

function formatHours(hours: number): string {
  return `${hours} h`;
}

function deltaClass(value: number): string {
  if (value > 0) return "text-emerald-600 dark:text-emerald-400";
  if (value < 0) return "text-rose-500";
  return "text-muted-foreground";
}

function deltaSign(value: number): string {
  return value > 0 ? "+" : "";
}

function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function statusDotClass(category: string): string {
  if (category === "done") return "state-done";
  if (category === "indeterminate") return "state-progress";
  return "state-todo";
}

const BUCKETS: { id: StatusBucket | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "deployed", label: "Deployed" },
  { id: "completed", label: "Completed" },
  { id: "in-progress", label: "In Progress" },
  { id: "todo", label: "To Do" },
];

export function QuarterlyTrackingSection({ boardId }: { boardId: string }) {
  const [quarterFilter, setQuarterFilter] = useState<string>("current");
  const [memberFilter, setMemberFilter] = useState<string>("all");
  const [bucketFilter, setBucketFilter] = useState<StatusBucket | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");

  const reportQuery = useActionQuery(
    "get-quarterly-report",
    { boardId },
    { placeholderData: (prev: unknown) => prev },
  );
  const data = reportQuery.data as QuarterlyReportData | undefined;

  // Sync filter state for agent context awareness
  useEffect(() => {
    writeClientAppState("sprint-reporting-quarterly-filter", {
      quarter: quarterFilter,
      member: memberFilter,
      bucket: bucketFilter,
      search: searchQuery || undefined,
    }).catch(() => {});
  }, [quarterFilter, memberFilter, bucketFilter, searchQuery]);

  const activeQuarterData = useMemo<QuarterlyQuarterData | null>(() => {
    if (!data) return null;
    if (quarterFilter === "current") return data.current;
    if (quarterFilter === "previous") return data.previous;
    return data.byQuarter?.[quarterFilter] ?? null;
  }, [data, quarterFilter]);

  const prevQuarterData = useMemo<QuarterlyQuarterData | null>(() => {
    if (!data || !activeQuarterData) return null;
    const { year, quarter } = activeQuarterData.meta;
    const prevQ = quarter === 1 ? 4 : quarter - 1;
    const prevYear = quarter === 1 ? year - 1 : year;
    const prevKey = `${prevYear}-Q${prevQ}`;
    return data.byQuarter?.[prevKey] ?? null;
  }, [data, activeQuarterData]);

  const teamMembers = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, { id: string; name: string; totalPoints: number; issueCount: number }>();
    const source = activeQuarterData ? activeQuarterData.issues : data.allIssues;
    for (const issue of source) {
      if (!issue.assigneeName) continue;
      const id = issue.assigneeAccountId ?? issue.assigneeName;
      const pts = issue.storyPoints ?? 0;
      const existing = map.get(id);
      if (existing) {
        existing.totalPoints = Math.round((existing.totalPoints + pts) * 10) / 10;
        existing.issueCount += 1;
      } else {
        map.set(id, { id, name: issue.assigneeName, totalPoints: pts, issueCount: 1 });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [data, activeQuarterData]);

  const filteredIssues = useMemo(() => {
    if (!data) return [];
    let list: QuarterlyIssueItem[] = activeQuarterData ? activeQuarterData.issues : data.allIssues;
    if (memberFilter !== "all") {
      list = list.filter((i) => (i.assigneeAccountId ?? i.assigneeName) === memberFilter);
    }
    if (bucketFilter !== "all") {
      list = list.filter((i) => i.bucket === bucketFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (i) =>
          i.key.toLowerCase().includes(q) ||
          i.summary.toLowerCase().includes(q) ||
          (i.assigneeName && i.assigneeName.toLowerCase().includes(q)) ||
          i.status.toLowerCase().includes(q),
      );
    }
    return list;
  }, [data, activeQuarterData, memberFilter, bucketFilter, searchQuery]);

  const bucketCounts = useMemo(() => {
    if (!data) return { all: 0, deployed: 0, completed: 0, "in-progress": 0, todo: 0 };
    let list = activeQuarterData ? activeQuarterData.issues : data.allIssues;
    if (memberFilter !== "all") {
      list = list.filter((i) => (i.assigneeAccountId ?? i.assigneeName) === memberFilter);
    }
    return {
      all: list.length,
      deployed: list.filter((i) => i.bucket === "deployed").length,
      completed: list.filter((i) => i.bucket === "completed").length,
      "in-progress": list.filter((i) => i.bucket === "in-progress").length,
      todo: list.filter((i) => i.bucket === "todo").length,
    };
  }, [data, activeQuarterData, memberFilter]);

  // KPI metrics for the selected period/member
  const activeMetrics = useMemo(() => {
    if (!data) return null;
    const cur = activeQuarterData ?? data.current;
    const prev = prevQuarterData ?? data.previous;

    if (memberFilter === "all") {
      const c = cur.totals;
      const p = prev.totals;
      const delta = Math.round((c.completedPoints - p.completedPoints) * 10) / 10;
      const deltaPct =
        p.completedPoints > 0
          ? Math.round(((c.completedPoints - p.completedPoints) / p.completedPoints) * 1000) / 10
          : null;
      return {
        isMember: false,
        name: "All Team Members",
        periodLabel: cur.meta.label,
        compareLabel: `vs ${p.completedPoints} pts in ${prev.meta.label}`,
        current: c,
        previous: p,
        hasComparison: true,
        comparison: {
          completedPointsDelta: delta,
          completedPointsPctDelta: deltaPct,
          committedPointsDelta: Math.round((c.committedPoints - p.committedPoints) * 10) / 10,
          doneCountDelta: c.doneCount - p.doneCount,
          issueCountDelta: c.issueCount - p.issueCount,
          loggedHoursDelta: Math.round((c.loggedHours - p.loggedHours) * 10) / 10,
        },
      };
    }

    const cMember = cur.team.find((m) => (m.assigneeAccountId ?? m.assigneeName) === memberFilter);
    const pMember = prev.team.find((m) => (m.assigneeAccountId ?? m.assigneeName) === memberFilter);
    const name = cMember?.assigneeName ?? pMember?.assigneeName ?? "Selected Member";

    const cPts = cMember?.completedPoints ?? 0;
    const pPts = pMember?.completedPoints ?? 0;
    const delta = Math.round((cPts - pPts) * 10) / 10;
    const deltaPct = pPts > 0 ? Math.round(((cPts - pPts) / pPts) * 1000) / 10 : null;

    const makeRow = (m?: QuarterlyMemberPerformance) => ({
      completedPoints: m?.completedPoints ?? 0,
      committedPoints: m?.committedPoints ?? 0,
      remainingPoints: Math.max(0, Math.round(((m?.committedPoints ?? 0) - (m?.completedPoints ?? 0)) * 10) / 10),
      completionPct:
        (m?.committedPoints ?? 0) > 0
          ? Math.round(((m?.completedPoints ?? 0) / (m?.committedPoints ?? 1)) * 1000) / 10
          : 0,
      doneCount: m?.doneCount ?? 0,
      issueCount: m?.totalCount ?? 0,
      inProgressCount: 0,
      todoCount: 0,
      loggedHours: m?.loggedHours ?? 0,
      worklogEntryCount: 0,
    });

    return {
      isMember: true,
      name,
      periodLabel: cur.meta.label,
      compareLabel: `vs ${pPts} pts in ${prev.meta.label}`,
      hasComparison: true,
      current: makeRow(cMember),
      previous: makeRow(pMember),
      comparison: {
        completedPointsDelta: delta,
        completedPointsPctDelta: deltaPct,
        committedPointsDelta: Math.round(((cMember?.committedPoints ?? 0) - (pMember?.committedPoints ?? 0)) * 10) / 10,
        doneCountDelta: (cMember?.doneCount ?? 0) - (pMember?.doneCount ?? 0),
        issueCountDelta: (cMember?.totalCount ?? 0) - (pMember?.totalCount ?? 0),
        loggedHoursDelta: Math.round(((cMember?.loggedHours ?? 0) - (pMember?.loggedHours ?? 0)) * 10) / 10,
      },
    };
  }, [data, activeQuarterData, prevQuarterData, memberFilter]);

  if (reportQuery.isLoading) {
    return (
      <div className="surface p-6">
        <div className="text-sm text-muted-foreground">Loading quarterly report…</div>
      </div>
    );
  }

  if (reportQuery.isError || !data) {
    return (
      <div className="surface p-6">
        <div className="text-sm text-destructive">
          {reportQuery.isError
            ? "Failed to load quarterly report."
            : "No sprint data synced yet. Run Sync now to populate."}
        </div>
      </div>
    );
  }

  const display = activeMetrics!;
  const cp = display.comparison;

  // Group quarters by year for the picker
  const yearMap = new Map<number, { key: string; label: string; isCurrent?: boolean; isPrevious?: boolean }[]>();
  for (const q of data.quarters) {
    const list = yearMap.get(q.year) ?? [];
    list.push({ key: q.key, label: q.label, isCurrent: q.isCurrent, isPrevious: q.isPrevious });
    yearMap.set(q.year, list);
  }
  const sortedYears = Array.from(yearMap.keys()).sort((a, b) => b - a);

  return (
    <div className="space-y-4">
      {/* Quarter picker */}
      <div className="surface p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide mr-1">Quarter</span>
          {sortedYears.map((year) => (
            <div key={year} className="flex flex-wrap gap-1">
              {(yearMap.get(year) ?? []).map((q) => (
                <button
                  key={q.key}
                  onClick={() => setQuarterFilter(q.key)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    quarterFilter === q.key || (quarterFilter === "current" && q.isCurrent)
                      ? "bg-foreground text-background"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {q.label}
                  {q.isCurrent ? " ·current" : q.isPrevious ? " ·prev" : ""}
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Member filter */}
        {teamMembers.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            <button
              onClick={() => setMemberFilter("all")}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                memberFilter === "all"
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              All members
            </button>
            {teamMembers.map((m) => (
              <button
                key={m.id}
                onClick={() => setMemberFilter(m.id)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  memberFilter === m.id
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {m.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* KPI cards */}
      <div className="surface p-4 sm:p-6">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">{display.periodLabel}</h2>
          {display.hasComparison && (
            <span className="text-xs text-muted-foreground">{display.compareLabel}</span>
          )}
        </div>

        <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-4">
          {/* Completed points */}
          <div>
            <div className="text-xs text-muted-foreground">Completed pts</div>
            <div className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">
              {display.current.completedPoints}
            </div>
            {display.hasComparison && (
              <div className={`mt-0.5 text-xs ${deltaClass(cp.completedPointsDelta)}`}>
                {deltaSign(cp.completedPointsDelta)}{cp.completedPointsDelta} pts
                {cp.completedPointsPctDelta != null && (
                  <span className="ml-1">({deltaSign(cp.completedPointsPctDelta)}{cp.completedPointsPctDelta}%)</span>
                )}
              </div>
            )}
          </div>

          {/* Committed points */}
          <div>
            <div className="text-xs text-muted-foreground">Committed pts</div>
            <div className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">
              {display.current.committedPoints}
            </div>
            {display.hasComparison && (
              <div className={`mt-0.5 text-xs ${deltaClass(cp.committedPointsDelta)}`}>
                {deltaSign(cp.committedPointsDelta)}{cp.committedPointsDelta} pts
              </div>
            )}
          </div>

          {/* Completion % */}
          <div>
            <div className="text-xs text-muted-foreground">Completion</div>
            <div className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">
              {display.current.completionPct}%
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {display.current.doneCount} of {display.current.issueCount} tickets done
            </div>
          </div>

          {/* Logged hours */}
          <div>
            <div className="text-xs text-muted-foreground">Logged hours</div>
            <div className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">
              {formatHours(display.current.loggedHours)}
            </div>
            {display.hasComparison && cp.loggedHoursDelta !== 0 && (
              <div className={`mt-0.5 text-xs ${deltaClass(cp.loggedHoursDelta)}`}>
                {deltaSign(cp.loggedHoursDelta)}{cp.loggedHoursDelta} h
              </div>
            )}
          </div>
        </div>

        {/* Progress bar */}
        {display.current.committedPoints > 0 && (
          <div className="mt-5">
            <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
              <span>{display.current.completionPct}% complete</span>
              <span>{display.current.remainingPoints} pts remaining</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-foreground rounded-full transition-all"
                style={{ width: `${Math.min(100, display.current.completionPct)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Charts — quarterly trends + status breakdown */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="surface p-4 sm:p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            Points by quarter
          </h3>
          <QuarterlyPointsChart
            quarters={data.quarters.map((q) => ({
              label: q.label,
              key: q.key,
              committed: data.byQuarter?.[q.key]?.totals.committedPoints ?? 0,
              completed: data.byQuarter?.[q.key]?.totals.completedPoints ?? 0,
              isCurrent: q.isCurrent,
            }))}
            onClickQuarter={setQuarterFilter}
          />
        </div>
        <div className="surface p-4 sm:p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            Status breakdown
          </h3>
          <StatusBreakdownChart
            buckets={{
              deployed: bucketCounts.deployed,
              completed: bucketCounts.completed,
              "in-progress": bucketCounts["in-progress"],
              todo: bucketCounts.todo,
            }}
          />
        </div>
      </div>

      {/* Quarter-over-quarter comparison summary */}
      <div className="surface p-4 sm:p-6">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-4">
          Quarter comparison
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Tickets done</div>
            <div className="text-xl font-semibold tabular-nums">{display.current.doneCount}</div>
            <div className={`text-xs ${deltaClass(cp.doneCountDelta)}`}>
              {deltaSign(cp.doneCountDelta)}{cp.doneCountDelta} vs prev Q
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Total tickets</div>
            <div className="text-xl font-semibold tabular-nums">{display.current.issueCount}</div>
            <div className={`text-xs ${deltaClass(cp.issueCountDelta)}`}>
              {deltaSign(cp.issueCountDelta)}{cp.issueCountDelta} vs prev Q
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">In progress</div>
            <div className="text-xl font-semibold tabular-nums">{display.current.inProgressCount}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">To do</div>
            <div className="text-xl font-semibold tabular-nums">{display.current.todoCount}</div>
          </div>
        </div>
      </div>

      {/* Team charts */}
      {memberFilter === "all" && activeQuarterData && activeQuarterData.team.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="surface p-4 sm:p-5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Team performance
            </h3>
            <TeamPerformanceChart
              team={activeQuarterData.team.map((m) => ({
                name: m.assigneeName,
                committed: m.committedPoints,
                completed: m.completedPoints,
              }))}
            />
          </div>
          <div className="surface p-4 sm:p-5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Logged hours
            </h3>
            <LoggedHoursChart
              team={activeQuarterData.team.map((m) => ({
                name: m.assigneeName,
                hours: m.loggedHours,
              }))}
            />
          </div>
        </div>
      )}

      {/* Team performance table */}
      {memberFilter === "all" && activeQuarterData && activeQuarterData.team.length > 0 && (
        <div className="surface p-4 sm:p-6">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-4">
            Team performance — {activeQuarterData.meta.label}
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="pb-2 text-left font-medium text-muted-foreground">Member</th>
                  <th className="pb-2 text-right font-medium text-muted-foreground">Committed</th>
                  <th className="pb-2 text-right font-medium text-muted-foreground">Completed</th>
                  <th className="pb-2 text-right font-medium text-muted-foreground">Done</th>
                  <th className="pb-2 text-right font-medium text-muted-foreground">Total</th>
                  <th className="pb-2 text-right font-medium text-muted-foreground">Logged</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {activeQuarterData.team.map((member) => {
                  const prevMember = prevQuarterData?.team.find(
                    (m) => (m.assigneeAccountId ?? m.assigneeName) === (member.assigneeAccountId ?? member.assigneeName),
                  );
                  const ptsDelta = prevMember
                    ? Math.round((member.completedPoints - prevMember.completedPoints) * 10) / 10
                    : null;
                  return (
                    <tr
                      key={member.assigneeAccountId ?? member.assigneeName}
                      className="cursor-pointer hover:bg-muted/30"
                      onClick={() =>
                        setMemberFilter(
                          memberFilter === (member.assigneeAccountId ?? member.assigneeName)
                            ? "all"
                            : (member.assigneeAccountId ?? member.assigneeName),
                        )
                      }
                    >
                      <td className="py-2 font-medium text-foreground">{member.assigneeName}</td>
                      <td className="py-2 text-right tabular-nums">{member.committedPoints} pts</td>
                      <td className="py-2 text-right tabular-nums">
                        {member.completedPoints} pts
                        {ptsDelta !== null && ptsDelta !== 0 && (
                          <span className={`ml-1 text-[10px] ${deltaClass(ptsDelta)}`}>
                            ({deltaSign(ptsDelta)}{ptsDelta})
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-right tabular-nums">{member.doneCount}</td>
                      <td className="py-2 text-right tabular-nums">{member.totalCount}</td>
                      <td className="py-2 text-right tabular-nums">{formatHours(member.loggedHours)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Ticket list */}
      <div className="surface p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Tickets
          </h3>
          <input
            type="search"
            placeholder="Search tickets…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 w-48 rounded-md border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-foreground/30"
          />
        </div>

        {/* Bucket filter tabs */}
        <div className="flex flex-wrap gap-1 mb-4">
          {BUCKETS.map((b) => {
            const count = bucketCounts[b.id];
            return (
              <button
                key={b.id}
                onClick={() => setBucketFilter(b.id)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  bucketFilter === b.id
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {b.label} {count > 0 && <span className="opacity-70">{count}</span>}
              </button>
            );
          })}
        </div>

        {filteredIssues.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">No tickets match the current filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="pb-2 text-left font-medium text-muted-foreground">Ticket</th>
                  <th className="pb-2 text-left font-medium text-muted-foreground">Status</th>
                  <th className="pb-2 text-left font-medium text-muted-foreground">Assignee</th>
                  <th className="pb-2 text-right font-medium text-muted-foreground">Points</th>
                  <th className="pb-2 text-right font-medium text-muted-foreground">Logged</th>
                  <th className="pb-2 text-right font-medium text-muted-foreground">Month</th>
                  <th className="pb-2 text-right font-medium text-muted-foreground">Resolved</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredIssues.map((issue) => (
                  <tr key={issue.id} className="hover:bg-muted/20">
                    <td className="py-2 pr-3">
                      <div className="font-medium text-foreground">{issue.key}</div>
                      <div className="max-w-[260px] truncate text-muted-foreground">{issue.summary}</div>
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-1.5">
                        <span className={`inline-block h-1.5 w-1.5 rounded-full ${statusDotClass(issue.statusCategory)}`} />
                        <span>{issue.status}</span>
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">{issue.assigneeName ?? "—"}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{issue.storyPoints ?? "—"}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {issue.loggedHours > 0 ? formatHours(issue.loggedHours) : "—"}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{issue.monthShort}</td>
                    <td className="py-2 text-right tabular-nums text-muted-foreground">
                      {formatDate(issue.resolvedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
