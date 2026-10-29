import { useEffect, useMemo, useState } from "react";

import { writeClientAppState } from "@agent-native/core/client/application-state";
import { callAction, useActionQuery } from "@agent-native/core/client/hooks";

import type {
  MonthlyIssueItem,
  MonthlyMonthData,
  MonthlyReportData,
  StatusBucket,
} from "../lib/monthly-report-types";
import {
  LoggedHoursChart,
  MonthlyPointsChart,
  StatusBreakdownChart,
  TeamPerformanceChart,
} from "./SprintCharts";

const SHORT_MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function formatHours(hours: number): string {
  return `${hours} h`;
}

function statusIndicatorClass(category: string): string {
  if (category === "done") return "state-done";
  if (category === "indeterminate") return "state-progress";
  return "state-todo";
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

export function MonthlyTrackingSection({
  boardId,
  initialMemberId = "all",
}: {
  boardId: string;
  initialMemberId?: string;
}) {
  const [monthFilter, setMonthFilter] = useState<string>("all");
  const [memberFilter, setMemberFilter] = useState<string>(initialMemberId);
  const [bucketFilter, setBucketFilter] = useState<StatusBucket | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [exporting, setExporting] = useState(false);

  const reportQuery = useActionQuery(
    "get-monthly-report",
    { boardId, month: "all" },
    { placeholderData: (prev: unknown) => prev },
  );

  const data = reportQuery.data as MonthlyReportData | undefined;

  // Sync current filter to application state for agent context awareness
  useEffect(() => {
    writeClientAppState("sprint-reporting-monthly-filter", {
      month: monthFilter,
      member: memberFilter,
      bucket: bucketFilter,
      search: searchQuery || undefined,
    }).catch(() => {});
  }, [monthFilter, memberFilter, bucketFilter, searchQuery]);

  // Resolve the active month dataset if a specific month is selected
  const activeMonthData = useMemo<MonthlyMonthData | null>(() => {
    if (!data || monthFilter === "all") return null;
    if (monthFilter === "current") return data.current;
    if (monthFilter === "previous") return data.previous;
    const lower = monthFilter.toLowerCase();
    return data.byMonth?.[monthFilter] || data.byMonth?.[lower] || null;
  }, [data, monthFilter]);

  // Resolve the preceding month relative to the active month for comparative metrics
  const prevMonthData = useMemo<MonthlyMonthData | null>(() => {
    if (!data || !activeMonthData) return null;
    const mNum = activeMonthData.meta.month;
    if (mNum > 1) {
      const prevKey = `${activeMonthData.meta.year}-${String(mNum - 1).padStart(2, "0")}`;
      const prevShort = SHORT_MONTH_NAMES[mNum - 2]?.toLowerCase();
      return (
        data.byMonth?.[prevKey] ||
        (prevShort ? data.byMonth?.[prevShort] : null) ||
        data.byMonth?.[String(mNum - 1)] ||
        null
      );
    }
    return null;
  }, [data, activeMonthData]);

  // List of all unique team members across all tracked issues
  const teamMembers = useMemo(() => {
    if (!data) return [];
    const map = new Map<
      string,
      {
        id: string;
        name: string;
        totalPoints: number;
        issueCount: number;
      }
    >();

    for (const issue of data.allIssues) {
      if (!issue.assigneeName) continue;
      const id = issue.assigneeAccountId ?? issue.assigneeName;
      const pts = issue.storyPoints ?? 0;
      const existing = map.get(id);
      if (existing) {
        existing.totalPoints = Math.round((existing.totalPoints + pts) * 10) / 10;
        existing.issueCount += 1;
      } else {
        map.set(id, {
          id,
          name: issue.assigneeName,
          totalPoints: Math.round(pts * 10) / 10,
          issueCount: 1,
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  // Filtered issues based on month, team member, status bucket, and search query
  const filteredIssues = useMemo(() => {
    if (!data) return [];
    let list: MonthlyIssueItem[] = [];
    if (activeMonthData) {
      list = activeMonthData.issues;
    } else {
      list = data.allIssues;
    }

    if (memberFilter !== "all") {
      list = list.filter(
        (i) => (i.assigneeAccountId ?? i.assigneeName) === memberFilter,
      );
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
  }, [data, activeMonthData, memberFilter, bucketFilter, searchQuery]);

  const bucketCounts = useMemo(() => {
    if (!data) {
      return { all: 0, deployed: 0, completed: 0, "in-progress": 0, todo: 0 };
    }
    let list = activeMonthData ? activeMonthData.issues : data.allIssues;

    if (memberFilter !== "all") {
      list = list.filter(
        (i) => (i.assigneeAccountId ?? i.assigneeName) === memberFilter,
      );
    }

    return {
      all: list.length,
      deployed: list.filter((i) => i.bucket === "deployed").length,
      completed: list.filter((i) => i.bucket === "completed").length,
      "in-progress": list.filter((i) => i.bucket === "in-progress").length,
      todo: list.filter((i) => i.bucket === "todo").length,
    };
  }, [data, activeMonthData, memberFilter]);

  // Dynamic KPI metrics: calculated based on the active month filter and member filter
  const activeMetrics = useMemo(() => {
    if (!data) return null;

    // Case 1: Specific month is active
    if (activeMonthData) {
      const m = activeMonthData;
      const prev = prevMonthData;

      if (memberFilter === "all") {
        const curTotals = m.totals;
        const prevTotals = prev?.totals ?? {
          completedPoints: 0,
          committedPoints: 0,
          remainingPoints: 0,
          completionPct: 0,
          doneCount: 0,
          issueCount: 0,
          loggedHours: 0,
          worklogEntryCount: 0,
        };

        const completedDelta = Math.round((curTotals.completedPoints - prevTotals.completedPoints) * 10) / 10;
        const completedPctDelta =
          prevTotals.completedPoints > 0
            ? Math.round(((curTotals.completedPoints - prevTotals.completedPoints) / prevTotals.completedPoints) * 1000) / 10
            : null;

        return {
          isMember: false,
          name: "All Team Members",
          periodLabel: m.meta.label,
          compareLabel: prev ? `vs ${prevTotals.completedPoints} pts in ${prev.meta.shortLabel}` : "Selected month total",
          current: curTotals,
          previous: prevTotals,
          hasComparison: !!prev,
          comparison: {
            completedPointsDelta: completedDelta,
            completedPointsPctDelta: completedPctDelta,
            committedPointsDelta: Math.round((curTotals.committedPoints - prevTotals.committedPoints) * 10) / 10,
            doneCountDelta: curTotals.doneCount - prevTotals.doneCount,
            issueCountDelta: curTotals.issueCount - prevTotals.issueCount,
            loggedHoursDelta: Math.round((curTotals.loggedHours - prevTotals.loggedHours) * 10) / 10,
          },
        };
      }

      // Member selected within a specific month
      const cMember = m.team.find(
        (tm) => (tm.assigneeAccountId ?? tm.assigneeName) === memberFilter,
      );
      const pMember = prev?.team.find(
        (tm) => (tm.assigneeAccountId ?? tm.assigneeName) === memberFilter,
      );
      const name = cMember?.assigneeName ?? pMember?.assigneeName ?? "Selected Member";

      const cCompleted = cMember?.completedPoints ?? 0;
      const cCommitted = cMember?.committedPoints ?? 0;
      const cRemaining = Math.max(0, Math.round((cCommitted - cCompleted) * 10) / 10);
      const cPct = cCommitted > 0 ? Math.round((cCompleted / cCommitted) * 1000) / 10 : 0;
      const cLogged = cMember?.loggedHours ?? 0;
      const cDone = cMember?.doneCount ?? 0;
      const cTotal = cMember?.totalCount ?? 0;

      const pCompleted = pMember?.completedPoints ?? 0;
      const pCommitted = pMember?.committedPoints ?? 0;
      const pRemaining = Math.max(0, Math.round((pCommitted - pCompleted) * 10) / 10);
      const pPct = pCommitted > 0 ? Math.round((pCompleted / pCommitted) * 1000) / 10 : 0;
      const pLogged = pMember?.loggedHours ?? 0;
      const pDone = pMember?.doneCount ?? 0;
      const pTotal = pMember?.totalCount ?? 0;

      const completedDelta = Math.round((cCompleted - pCompleted) * 10) / 10;
      const completedPctDelta =
        pCompleted > 0 ? Math.round(((cCompleted - pCompleted) / pCompleted) * 1000) / 10 : null;

      return {
        isMember: true,
        name,
        periodLabel: m.meta.label,
        compareLabel: prev ? `vs ${pCompleted} pts in ${prev.meta.shortLabel}` : "Selected month total",
        hasComparison: !!prev,
        current: {
          completedPoints: cCompleted,
          committedPoints: cCommitted,
          remainingPoints: cRemaining,
          completionPct: cPct,
          doneCount: cDone,
          issueCount: cTotal,
          loggedHours: cLogged,
          worklogEntryCount: 0,
        },
        previous: {
          completedPoints: pCompleted,
          committedPoints: pCommitted,
          remainingPoints: pRemaining,
          completionPct: pPct,
          doneCount: pDone,
          issueCount: pTotal,
          loggedHours: pLogged,
          worklogEntryCount: 0,
        },
        comparison: {
          completedPointsDelta: completedDelta,
          completedPointsPctDelta: completedPctDelta,
          committedPointsDelta: Math.round((cCommitted - pCommitted) * 10) / 10,
          doneCountDelta: cDone - pDone,
          issueCountDelta: cTotal - pTotal,
          loggedHoursDelta: Math.round((cLogged - pLogged) * 10) / 10,
        },
      };
    }

    // Case 2: "All Months" overview — compares current vs previous month (MoM)
    if (memberFilter === "all") {
      return {
        isMember: false,
        name: "All Team Members",
        periodLabel: `${data.current.meta.label}`,
        compareLabel: `vs ${data.previous.totals.completedPoints} pts in ${data.previous.meta.shortLabel}`,
        current: data.current.totals,
        previous: data.previous.totals,
        hasComparison: true,
        comparison: data.comparison,
      };
    }

    const cMember = data.current.team.find(
      (m) => (m.assigneeAccountId ?? m.assigneeName) === memberFilter,
    );
    const pMember = data.previous.team.find(
      (m) => (m.assigneeAccountId ?? m.assigneeName) === memberFilter,
    );
    const name = cMember?.assigneeName ?? pMember?.assigneeName ?? "Selected Member";

    const cCompleted = cMember?.completedPoints ?? 0;
    const cCommitted = cMember?.committedPoints ?? 0;
    const cRemaining = Math.max(0, Math.round((cCommitted - cCompleted) * 10) / 10);
    const cPct = cCommitted > 0 ? Math.round((cCompleted / cCommitted) * 1000) / 10 : 0;
    const cLogged = cMember?.loggedHours ?? 0;
    const cDone = cMember?.doneCount ?? 0;
    const cTotal = cMember?.totalCount ?? 0;

    const pCompleted = pMember?.completedPoints ?? 0;
    const pCommitted = pMember?.committedPoints ?? 0;
    const pRemaining = Math.max(0, Math.round((pCommitted - pCompleted) * 10) / 10);
    const pPct = pCommitted > 0 ? Math.round((pCompleted / pCommitted) * 1000) / 10 : 0;
    const pLogged = pMember?.loggedHours ?? 0;
    const pDone = pMember?.doneCount ?? 0;
    const pTotal = pMember?.totalCount ?? 0;

    const completedDelta = Math.round((cCompleted - pCompleted) * 10) / 10;
    const completedPctDelta =
      pCompleted > 0 ? Math.round(((cCompleted - pCompleted) / pCompleted) * 1000) / 10 : null;

    return {
      isMember: true,
      name,
      periodLabel: `${data.current.meta.label}`,
      compareLabel: `vs ${pCompleted} pts in ${data.previous.meta.shortLabel}`,
      hasComparison: true,
      current: {
        completedPoints: cCompleted,
        committedPoints: cCommitted,
        remainingPoints: cRemaining,
        completionPct: cPct,
        doneCount: cDone,
        issueCount: cTotal,
        loggedHours: cLogged,
        worklogEntryCount: 0,
      },
      previous: {
        completedPoints: pCompleted,
        committedPoints: pCommitted,
        remainingPoints: pRemaining,
        completionPct: pPct,
        doneCount: pDone,
        issueCount: pTotal,
        loggedHours: pLogged,
        worklogEntryCount: 0,
      },
      comparison: {
        completedPointsDelta: completedDelta,
        completedPointsPctDelta: completedPctDelta,
        committedPointsDelta: Math.round((cCommitted - pCommitted) * 10) / 10,
        doneCountDelta: cDone - pDone,
        issueCountDelta: cTotal - pTotal,
        loggedHoursDelta: Math.round((cLogged - pLogged) * 10) / 10,
      },
    };
  }, [data, activeMonthData, prevMonthData, memberFilter]);

  async function handleExport() {
    setExporting(true);
    try {
      const result = await callAction<{ filename: string; csv: string }>(
        "export-monthly-report",
        { boardId, month: monthFilter !== "all" ? monthFilter : undefined },
        { method: "GET" },
      );
      triggerCsvDownload(result.filename, result.csv);
    } finally {
      setExporting(false);
    }
  }

  if (reportQuery.isLoading && !data) {
    return (
      <div className="surface p-8 text-center text-sm text-muted-foreground">
        <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        Loading month-wise report…
      </div>
    );
  }

  if (reportQuery.isError || !data || !activeMetrics) {
    return (
      <div className="surface p-8 text-center text-sm text-muted-foreground">
        Unable to load monthly report for this board. Make sure at least one sprint has been synced.
      </div>
    );
  }

  const { current, previous } = data;
  const metrics = activeMetrics;

  return (
    <div className="space-y-6">
      {/* Top Controls Surface: Month Filter Bar & Team Member Selector */}
      <section className="surface p-5 sm:p-6" aria-labelledby="monthly-heading">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="monthly-heading" className="text-sm font-semibold text-foreground">
                Month-wise tracking & velocity
              </h2>
              {activeMonthData ? (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                  Filter: {activeMonthData.meta.label}
                </span>
              ) : (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                  All Months Overview
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Filter by any month (Jan, Feb, Mar, etc.) to review team velocity, points, and tickets.
            </p>
          </div>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            className="secondary-button text-xs font-medium"
          >
            {exporting
              ? "Exporting…"
              : activeMonthData
                ? `Export ${activeMonthData.meta.shortLabel} CSV`
                : "Export monthly CSV"}
          </button>
        </div>

        {/* Month Selector — grouped by year, full YYYY-MM key used so multiple years don't collide */}
        <div className="mt-6 border-t border-border pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
            <span className="text-xs font-semibold text-foreground">
              Filter by Month:
            </span>
            {activeMonthData && (
              <button
                type="button"
                onClick={() => setMonthFilter("all")}
                className="text-xs font-medium text-primary hover:underline"
              >
                Reset to All Months
              </button>
            )}
          </div>

          {/* Build year→months map from data.months */}
          {(() => {
            const yearMap = new Map<number, typeof data.months>();
            for (const m of (data.months || [])) {
              const list = yearMap.get(m.year) ?? [];
              list.push(m);
              yearMap.set(m.year, list);
            }
            const sortedYears = Array.from(yearMap.keys()).sort((a, b) => b - a);
            return (
              <div className="space-y-2">
                {/* All Months button */}
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                      monthFilter === "all"
                        ? "bg-card text-foreground font-semibold shadow-xs ring-1 ring-border"
                        : "text-muted-foreground hover:bg-card/50 hover:text-foreground"
                    }`}
                    onClick={() => setMonthFilter("all")}
                  >
                    All Months
                  </button>
                </div>

                {sortedYears.map((year) => (
                  <div key={year}>
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {year}
                    </div>
                    <div
                      className="flex flex-wrap items-center gap-1.5 rounded-lg bg-muted/50 p-1.5"
                      role="tablist"
                      aria-label={`Filter by month — ${year}`}
                    >
                      {(yearMap.get(year) ?? []).map((m) => {
                        const isSelected =
                          monthFilter === m.key ||
                          (monthFilter === "current" && m.isCurrent) ||
                          (monthFilter === "previous" && m.isPrevious);

                        return (
                          <button
                            key={m.key}
                            type="button"
                            title={`${m.label} (${m.issueCount} tickets)`}
                            onClick={() => setMonthFilter(isSelected ? "all" : m.key)}
                            className={`group relative flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all ${
                              isSelected
                                ? "bg-card text-foreground font-semibold shadow-xs ring-2 ring-primary"
                                : m.hasData
                                  ? "text-foreground hover:bg-card/70"
                                  : "text-muted-foreground/60 hover:text-muted-foreground hover:bg-card/30"
                            }`}
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
                ))}
              </div>
            );
          })()}


          {/* Active Month Info Banner */}
          {activeMonthData && (
            <div className="mt-2.5 flex items-center justify-between rounded-md bg-primary/10 px-3 py-1.5 text-xs text-primary">
              <span>
                Showing data strictly for{" "}
                <strong className="font-semibold text-foreground">
                  {activeMonthData.meta.label}
                </strong>
                {activeMonthData.meta.isCurrent && " (Current Month)"}
                {activeMonthData.meta.isPrevious && " (Previous Month)"}
                {" — "}
                <span className="tabular-nums">
                  {activeMonthData.totals.issueCount} ticket
                  {activeMonthData.totals.issueCount === 1 ? "" : "s"}
                </span>
                ,{" "}
                <span className="tabular-nums">
                  {activeMonthData.totals.committedPoints} story pts
                </span>
              </span>
              <button
                type="button"
                onClick={() => setMonthFilter("all")}
                className="font-medium hover:underline"
              >
                Clear month filter
              </button>
            </div>
          )}
        </div>

        {/* Team Member Selector */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Team Member:</span>
            <div className="relative">
              <select
                value={memberFilter}
                onChange={(e) => setMemberFilter(e.target.value)}
                className="h-8 rounded-md border border-border bg-card px-3 text-xs font-medium text-foreground shadow-xs focus:border-primary focus:outline-hidden"
              >
                <option value="all">All Team Members ({teamMembers.length})</option>
                {teamMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.totalPoints} pts, {m.issueCount} tickets)
                  </option>
                ))}
              </select>
            </div>
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

          {metrics.isMember && (
            <div className="text-xs text-muted-foreground">
              Filtering for <strong className="text-foreground">{metrics.name}</strong>
            </div>
          )}
        </div>

        {/* High-level KPI comparison grid (dynamically reflects selected member & selected month) */}
        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {/* Card 1: Completed Points */}
          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <div className="text-[11px] font-medium text-muted-foreground">
              Completed Story Points
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-2">
              <span className="tabular-nums text-2xl font-bold tracking-tight text-foreground">
                {metrics.current.completedPoints}
                <span className="ml-1 text-xs font-normal text-muted-foreground">pts</span>
              </span>
              {metrics.hasComparison && (
                <span
                  className={`text-[11px] font-semibold ${
                    metrics.comparison.completedPointsDelta >= 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400"
                  }`}
                >
                  {metrics.comparison.completedPointsDelta >= 0 ? "▲ +" : "▼ "}
                  {metrics.comparison.completedPointsDelta} pts
                </span>
              )}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {metrics.compareLabel}
            </div>
          </div>

          {/* Card 2: Committed / Planned Points */}
          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <div className="text-[11px] font-medium text-muted-foreground">
              Committed Points
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-2">
              <span className="tabular-nums text-2xl font-bold tracking-tight text-foreground">
                {metrics.current.committedPoints}
                <span className="ml-1 text-xs font-normal text-muted-foreground">pts</span>
              </span>
              {metrics.hasComparison && (
                <span
                  className={`text-[11px] font-semibold ${
                    metrics.comparison.committedPointsDelta >= 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-muted-foreground"
                  }`}
                >
                  {metrics.comparison.committedPointsDelta >= 0 ? "+" : ""}
                  {metrics.comparison.committedPointsDelta} pts
                </span>
              )}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {metrics.hasComparison
                ? `vs ${metrics.previous.committedPoints} pts committed`
                : `${metrics.current.remainingPoints} pts remaining`}
            </div>
          </div>

          {/* Card 3: Completion Rate */}
          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <div className="text-[11px] font-medium text-muted-foreground">
              Completion Rate
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-2">
              <span className="tabular-nums text-2xl font-bold tracking-tight text-foreground">
                {metrics.current.completionPct}%
              </span>
              {metrics.hasComparison && (
                <span
                  className={`text-[11px] font-semibold ${
                    metrics.current.completionPct >= metrics.previous.completionPct
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400"
                  }`}
                >
                  {metrics.current.completionPct >= metrics.previous.completionPct ? "▲ +" : "▼ "}
                  {Math.round((metrics.current.completionPct - metrics.previous.completionPct) * 10) / 10}%
                </span>
              )}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {metrics.current.doneCount} of {metrics.current.issueCount} tickets done
            </div>
          </div>

          {/* Card 4: Hours Logged */}
          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <div className="text-[11px] font-medium text-muted-foreground">Logged Hours</div>
            <div className="mt-2 flex items-baseline justify-between gap-2">
              <span className="tabular-nums text-2xl font-bold tracking-tight text-foreground">
                {formatHours(metrics.current.loggedHours)}
              </span>
              {metrics.hasComparison && (
                <span
                  className={`text-[11px] font-semibold ${
                    metrics.comparison.loggedHoursDelta >= 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-muted-foreground"
                  }`}
                >
                  {metrics.comparison.loggedHoursDelta >= 0 ? "+" : ""}
                  {metrics.comparison.loggedHoursDelta} h
                </span>
              )}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {metrics.hasComparison
                ? `vs ${formatHours(metrics.previous.loggedHours)}`
                : "Total logged work"}
            </div>
          </div>
        </div>
      </section>

      {/* Charts row: trend + status breakdown */}
      <div className="grid gap-4 sm:grid-cols-2">
        <section className="surface p-4 sm:p-5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Points by month
          </h3>
          <MonthlyPointsChart
            months={(data.months || []).map((m) => ({
              label: m.shortMonthName,
              key: m.key,
              committed: data.byMonth?.[m.key]?.totals.committedPoints ?? 0,
              completed: data.byMonth?.[m.key]?.totals.completedPoints ?? 0,
              isCurrent: m.isCurrent,
            }))}
            onClickMonth={setMonthFilter}
          />
        </section>
        <section className="surface p-4 sm:p-5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Status breakdown
            {activeMonthData ? ` — ${activeMonthData.meta.shortLabel}` : " — all months"}
          </h3>
          <StatusBreakdownChart
            buckets={
              activeMonthData
                ? activeMonthData.statusBuckets
                : (data.months || []).reduce(
                    (acc, m) => {
                      const sb = data.byMonth?.[m.key]?.statusBuckets;
                      if (sb) {
                        acc.deployed = (acc.deployed ?? 0) + (sb.deployed ?? 0);
                        acc.completed = (acc.completed ?? 0) + (sb.completed ?? 0);
                        acc["in-progress"] = (acc["in-progress"] ?? 0) + (sb["in-progress"] ?? 0);
                        acc.todo = (acc.todo ?? 0) + (sb.todo ?? 0);
                      }
                      return acc;
                    },
                    {} as Record<string, number>,
                  )
            }
          />
        </section>
      </div>

      {/* Month Overview / Focus Section */}
      {activeMonthData ? (
        /* Focus Section for the specifically selected month */
        <div className={prevMonthData ? "grid gap-4 md:grid-cols-2" : "grid gap-4"}>
          {/* Active Selected Month Focus Card */}
          <section className="surface p-5 ring-2 ring-primary">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    activeMonthData.meta.isCurrent ? "bg-emerald-500 animate-pulse" : "bg-primary"
                  }`}
                />
                <h3 className="text-sm font-semibold text-foreground">
                  {activeMonthData.meta.label} Focus
                </h3>
              </div>
              <span className="rounded bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                {activeMonthData.meta.isCurrent
                  ? "Current Month (Active)"
                  : activeMonthData.meta.isPrevious
                    ? "Previous Month"
                    : `${activeMonthData.meta.shortMonthName} ${activeMonthData.meta.year}`}
              </span>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-4">
              <div>
                <div className="text-[11px] text-muted-foreground">Completed Points</div>
                <div className="mt-1 tabular-nums text-xl font-bold text-foreground">
                  {activeMonthData.totals.completedPoints}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    / {activeMonthData.totals.committedPoints} pts
                  </span>
                </div>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground">Done Tickets</div>
                <div className="mt-1 tabular-nums text-xl font-bold text-foreground">
                  {activeMonthData.totals.doneCount}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    / {activeMonthData.totals.issueCount} tickets
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-4">
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>Completion Velocity</span>
                <span className="font-semibold text-foreground">
                  {activeMonthData.totals.completionPct}%
                </span>
              </div>
              <div className="progress-track mt-1.5">
                <span
                  className="progress-fill"
                  style={{
                    width: `${Math.min(100, activeMonthData.totals.completionPct)}%`,
                    backgroundColor: activeMonthData.meta.isCurrent ? "#1baf7a" : "#2a78d6",
                  }}
                />
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4 text-[11px]">
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-700 dark:text-emerald-300">
                Deployed: {activeMonthData.statusBuckets.deployed}
              </span>
              <span className="rounded-full bg-blue-500/10 px-2 py-0.5 font-medium text-blue-700 dark:text-blue-300">
                Completed: {activeMonthData.statusBuckets.completed}
              </span>
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-300">
                In Progress: {activeMonthData.statusBuckets["in-progress"]}
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground">
                To Do: {activeMonthData.statusBuckets.todo}
              </span>
            </div>
          </section>

          {/* Preceding Month Comparison Card (if available) */}
          {prevMonthData && (
            <section
              className="surface cursor-pointer p-5 transition-all hover:border-primary/50"
              onClick={() => setMonthFilter(prevMonthData.meta.key)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-muted-foreground/60" />
                  <h3 className="text-sm font-semibold text-foreground">
                    {prevMonthData.meta.label}
                  </h3>
                </div>
                <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  Preceding Month (Click to switch)
                </span>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[11px] text-muted-foreground">Completed Points</div>
                  <div className="mt-1 tabular-nums text-xl font-bold text-foreground">
                    {prevMonthData.totals.completedPoints}{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      / {prevMonthData.totals.committedPoints} pts
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">Done Tickets</div>
                  <div className="mt-1 tabular-nums text-xl font-bold text-foreground">
                    {prevMonthData.totals.doneCount}{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      / {prevMonthData.totals.issueCount} tickets
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>Completion Velocity</span>
                  <span className="font-semibold text-foreground">
                    {prevMonthData.totals.completionPct}%
                  </span>
                </div>
                <div className="progress-track mt-1.5">
                  <span
                    className="progress-fill"
                    style={{
                      width: `${Math.min(100, prevMonthData.totals.completionPct)}%`,
                      backgroundColor: "#6b7280",
                    }}
                  />
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4 text-[11px]">
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-700 dark:text-emerald-300">
                  Deployed: {prevMonthData.statusBuckets.deployed}
                </span>
                <span className="rounded-full bg-blue-500/10 px-2 py-0.5 font-medium text-blue-700 dark:text-blue-300">
                  Completed: {prevMonthData.statusBuckets.completed}
                </span>
                <span className="rounded-full bg-amber-500/10 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-300">
                  In Progress: {prevMonthData.statusBuckets["in-progress"]}
                </span>
                <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground">
                  To Do: {prevMonthData.statusBuckets.todo}
                </span>
              </div>
            </section>
          )}
        </div>
      ) : (
        /* Side-by-Side Month Comparisons (when All Months is selected) */
        <div className="grid gap-4 md:grid-cols-2">
          {/* Previous Month Card */}
          <section
            className="surface cursor-pointer p-5 transition-all hover:border-primary/50"
            onClick={() => setMonthFilter(previous.meta.key)}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-blue-500" />
                <h3 className="text-sm font-semibold text-foreground">
                  {previous.meta.label}
                </h3>
              </div>
              <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                Previous Month
              </span>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-4">
              <div>
                <div className="text-[11px] text-muted-foreground">Completed Points</div>
                <div className="mt-1 tabular-nums text-xl font-bold text-foreground">
                  {previous.totals.completedPoints}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    / {previous.totals.committedPoints} pts
                  </span>
                </div>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground">Done Tickets</div>
                <div className="mt-1 tabular-nums text-xl font-bold text-foreground">
                  {previous.totals.doneCount}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    / {previous.totals.issueCount} tickets
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-4">
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>Completion Velocity</span>
                <span className="font-semibold text-foreground">
                  {previous.totals.completionPct}%
                </span>
              </div>
              <div className="progress-track mt-1.5">
                <span
                  className="progress-fill"
                  style={{
                    width: `${Math.min(100, previous.totals.completionPct)}%`,
                    backgroundColor: "#2a78d6",
                  }}
                />
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4 text-[11px]">
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-700 dark:text-emerald-300">
                Deployed: {previous.statusBuckets.deployed}
              </span>
              <span className="rounded-full bg-blue-500/10 px-2 py-0.5 font-medium text-blue-700 dark:text-blue-300">
                Completed: {previous.statusBuckets.completed}
              </span>
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-300">
                In Progress: {previous.statusBuckets["in-progress"]}
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground">
                To Do: {previous.statusBuckets.todo}
              </span>
            </div>
          </section>

          {/* Current Month Card */}
          <section
            className="surface cursor-pointer p-5 transition-all hover:border-primary/50"
            onClick={() => setMonthFilter(current.meta.key)}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                <h3 className="text-sm font-semibold text-foreground">
                  {current.meta.label}
                </h3>
              </div>
              <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                Current Month (Active)
              </span>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-4">
              <div>
                <div className="text-[11px] text-muted-foreground">Completed Points</div>
                <div className="mt-1 tabular-nums text-xl font-bold text-foreground">
                  {current.totals.completedPoints}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    / {current.totals.committedPoints} pts
                  </span>
                </div>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground">Done Tickets</div>
                <div className="mt-1 tabular-nums text-xl font-bold text-foreground">
                  {current.totals.doneCount}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    / {current.totals.issueCount} tickets
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-4">
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>Completion Velocity</span>
                <span className="font-semibold text-foreground">
                  {current.totals.completionPct}%
                </span>
              </div>
              <div className="progress-track mt-1.5">
                <span
                  className="progress-fill"
                  style={{
                    width: `${Math.min(100, current.totals.completionPct)}%`,
                    backgroundColor: "#1baf7a",
                  }}
                />
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4 text-[11px]">
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-700 dark:text-emerald-300">
                Deployed: {current.statusBuckets.deployed}
              </span>
              <span className="rounded-full bg-blue-500/10 px-2 py-0.5 font-medium text-blue-700 dark:text-blue-300">
                Completed: {current.statusBuckets.completed}
              </span>
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-300">
                In Progress: {current.statusBuckets["in-progress"]}
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground">
                To Do: {current.statusBuckets.todo}
              </span>
            </div>
          </section>
        </div>
      )}

      {/* Team Performance Table (Dynamic based on selected Month filter) */}
      <section className="surface p-5 sm:p-6" aria-labelledby="monthly-team-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 id="monthly-team-heading" className="text-sm font-semibold text-foreground">
              {activeMonthData
                ? `Team performance: ${activeMonthData.meta.label}`
                : `Team performance: ${previous.meta.shortLabel} vs ${current.meta.shortLabel}`}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Click any team member to filter metrics and tickets to them.
            </p>
          </div>
          {memberFilter !== "all" && (
            <button
              type="button"
              onClick={() => setMemberFilter("all")}
              className="text-xs text-primary hover:underline"
            >
              Show all team members
            </button>
          )}
        </div>

        {/* Charts: team points + logged hours */}
        {memberFilter === "all" && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Points by member
              </div>
              <TeamPerformanceChart
                team={(activeMonthData ? activeMonthData.team : current.team).map((m) => ({
                  name: m.assigneeName,
                  committed: m.committedPoints,
                  completed: m.completedPoints,
                }))}
              />
            </div>
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Hours logged by member
              </div>
              <LoggedHoursChart
                team={(activeMonthData ? activeMonthData.team : current.team)
                  .map((m) => ({ name: m.assigneeName, hours: m.loggedHours }))}
              />
            </div>
          </div>
        )}

        <div className="mt-5 overflow-x-auto">
          {activeMonthData ? (
            /* Specific Month Team Breakdown */
            <table className="w-full min-w-[620px] text-left text-xs">
              <thead className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="py-2.5 pr-4 font-medium">Team Member</th>
                  <th className="py-2.5 pr-4 text-right font-medium">Completed Points</th>
                  <th className="py-2.5 pr-4 text-right font-medium">Committed Points</th>
                  <th className="py-2.5 pr-4 text-right font-medium">Velocity</th>
                  <th className="py-2.5 pr-4 text-right font-medium">Done Tickets</th>
                  <th className="py-2.5 text-right font-medium">Hours Logged</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {activeMonthData.team
                  .filter((m) =>
                    memberFilter === "all"
                      ? true
                      : (m.assigneeAccountId ?? m.assigneeName) === memberFilter,
                  )
                  .map((m) => {
                    const key = m.assigneeAccountId ?? m.assigneeName;
                    const isSelected = memberFilter === key;
                    const pct =
                      m.committedPoints > 0
                        ? Math.round((m.completedPoints / m.committedPoints) * 1000) / 10
                        : 0;

                    return (
                      <tr
                        key={key}
                        onClick={() => setMemberFilter(isSelected ? "all" : key)}
                        className={`cursor-pointer transition-colors hover:bg-muted/40 ${
                          isSelected ? "bg-primary/10 font-semibold" : ""
                        }`}
                      >
                        <td className="py-3 pr-4 font-medium text-foreground">
                          <div className="flex items-center gap-2">
                            {isSelected && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                            <span>{m.assigneeName}</span>
                          </div>
                        </td>
                        <td className="py-3 pr-4 text-right tabular-nums text-foreground font-semibold">
                          {m.completedPoints} pts
                        </td>
                        <td className="py-3 pr-4 text-right tabular-nums text-muted-foreground">
                          {m.committedPoints} pts
                        </td>
                        <td className="py-3 pr-4 text-right tabular-nums font-medium text-foreground">
                          {pct}%
                        </td>
                        <td className="py-3 pr-4 text-right tabular-nums text-muted-foreground">
                          {m.doneCount} / {m.totalCount}
                        </td>
                        <td className="py-3 text-right tabular-nums text-muted-foreground">
                          {formatHours(m.loggedHours)}
                        </td>
                      </tr>
                    );
                  })}
                {activeMonthData.team.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-muted-foreground">
                      No team members with assigned tickets in {activeMonthData.meta.label}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            /* All Months MoM Comparative Table */
            <table className="w-full min-w-[620px] text-left text-xs">
              <thead className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="py-2.5 pr-4 font-medium">Team Member</th>
                  <th className="py-2.5 pr-4 text-right font-medium">
                    {previous.meta.shortLabel} (Pts)
                  </th>
                  <th className="py-2.5 pr-4 text-right font-medium">
                    {current.meta.shortLabel} (Pts)
                  </th>
                  <th className="py-2.5 pr-4 text-right font-medium">MoM Delta</th>
                  <th className="py-2.5 text-right font-medium">
                    Hours ({previous.meta.shortLabel} / {current.meta.shortLabel})
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {teamMembers
                  .filter((m) => (memberFilter === "all" ? true : m.id === memberFilter))
                  .map((tm) => {
                    const key = tm.id;
                    const cMember = current.team.find(
                      (m) => (m.assigneeAccountId ?? m.assigneeName) === key,
                    );
                    const pMember = previous.team.find(
                      (m) => (m.assigneeAccountId ?? m.assigneeName) === key,
                    );
                    const name = tm.name;
                    const cCompleted = cMember?.completedPoints ?? 0;
                    const cCommitted = cMember?.committedPoints ?? 0;
                    const pCompleted = pMember?.completedPoints ?? 0;
                    const pCommitted = pMember?.committedPoints ?? 0;
                    const delta = Math.round((cCompleted - pCompleted) * 10) / 10;
                    const isSelected = memberFilter === key;

                    return (
                      <tr
                        key={key}
                        onClick={() => setMemberFilter(isSelected ? "all" : key)}
                        className={`cursor-pointer transition-colors hover:bg-muted/40 ${
                          isSelected ? "bg-primary/10 font-semibold" : ""
                        }`}
                      >
                        <td className="py-3 pr-4 font-medium text-foreground">
                          <div className="flex items-center gap-2">
                            {isSelected && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                            <span>{name}</span>
                          </div>
                        </td>
                        <td className="py-3 pr-4 text-right tabular-nums text-muted-foreground">
                          <strong className="text-foreground">{pCompleted}</strong> / {pCommitted} pts
                        </td>
                        <td className="py-3 pr-4 text-right tabular-nums text-muted-foreground">
                          <strong className="text-foreground">{cCompleted}</strong> / {cCommitted} pts
                        </td>
                        <td className="py-3 pr-4 text-right tabular-nums font-medium">
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
                        </td>
                        <td className="py-3 text-right tabular-nums text-muted-foreground">
                          {formatHours(pMember?.loggedHours ?? 0)} / {formatHours(cMember?.loggedHours ?? 0)}
                        </td>
                      </tr>
                    );
                  })}
                {teamMembers.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-muted-foreground">
                      No team members matching your filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Filterable Ticket Details Section */}
      <section className="surface overflow-hidden" aria-labelledby="monthly-tickets-heading">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h3 id="monthly-tickets-heading" className="text-sm font-semibold text-foreground">
              {activeMonthData
                ? `Tickets in ${activeMonthData.meta.label}`
                : "Tickets in all tracked months"}
            </h3>
            <span className="text-[11px] text-muted-foreground">
              Showing {filteredIssues.length} ticket{filteredIssues.length === 1 ? "" : "s"}
              {memberFilter !== "all" && (
                <> for <strong className="text-foreground">{metrics.name}</strong></>
              )}
            </span>
          </div>

          {/* Quick Clear All Filters */}
          {(memberFilter !== "all" || monthFilter !== "all" || bucketFilter !== "all" || searchQuery) && (
            <button
              type="button"
              onClick={() => {
                setMemberFilter("all");
                setMonthFilter("all");
                setBucketFilter("all");
                setSearchQuery("");
              }}
              className="text-xs text-primary hover:underline"
            >
              Reset all filters
            </button>
          )}
        </div>

        {/* Filter bar: status buckets and search input */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/20 px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-1">
            {(
              [
                { id: "all", label: "All" },
                { id: "deployed", label: "Deployed" },
                { id: "completed", label: "Completed" },
                { id: "in-progress", label: "In Progress" },
                { id: "todo", label: "To Do" },
              ] as const
            ).map((b) => (
              <button
                key={b.id}
                type="button"
                className={`report-tab text-xs whitespace-nowrap ${
                  bucketFilter === b.id ? "report-tab-active" : ""
                }`}
                onClick={() => setBucketFilter(b.id)}
              >
                {b.label}{" "}
                <span className="tabular-nums text-muted-foreground">
                  {bucketCounts[b.id]}
                </span>
              </button>
            ))}
          </div>

          <div className="w-full sm:w-64">
            <input
              type="search"
              placeholder="Search key, summary, assignee…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded border border-border bg-card px-2.5 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-hidden"
            />
          </div>
        </div>

        {/* Ticket List Table */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="bg-muted/60 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">Ticket</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Month</th>
                <th className="px-5 py-3 font-medium">Assignee</th>
                <th className="px-5 py-3 text-right font-medium">Points</th>
                <th className="px-5 py-3 text-right font-medium">Resolved / Created</th>
                <th className="px-5 py-3 text-right font-medium">Logged</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredIssues.map((t) => (
                <tr key={t.id} className="hover:bg-muted/20">
                  <td className="px-5 py-3">
                    <span className="font-semibold text-foreground">{t.key}</span>{" "}
                    <span className="ml-1.5 rounded bg-muted/60 px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                      {t.issueType}
                    </span>
                    <div className="mt-0.5 line-clamp-1 text-muted-foreground">
                      {t.summary}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-5 py-3">
                    <span className={`state-indicator ${statusIndicatorClass(t.statusCategory)}`} />
                    <span className="font-medium text-foreground">{t.status}</span>
                  </td>
                  <td className="whitespace-nowrap px-5 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        t.monthRole === "current"
                          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                          : t.monthRole === "previous"
                            ? "bg-blue-500/10 text-blue-700 dark:text-blue-300"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {t.monthShort || (t.monthRole === "current" ? current.meta.shortLabel : previous.meta.shortLabel)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">
                    <button
                      type="button"
                      onClick={() => setMemberFilter(t.assigneeAccountId ?? t.assigneeName ?? "all")}
                      className="hover:text-foreground hover:underline"
                    >
                      {t.assigneeName ?? "—"}
                    </button>
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums font-medium text-foreground">
                    {t.storyPoints !== null ? (
                      <span className="rounded bg-muted px-1.5 py-0.5">
                        {t.storyPoints} pts
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums text-muted-foreground">
                    {formatDate(t.resolvedAt ?? t.createdAt)}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums text-muted-foreground">
                    {formatHours(t.loggedHours)}
                  </td>
                </tr>
              ))}
              {filteredIssues.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-sm text-muted-foreground">
                    {activeMonthData
                      ? `No tickets found matching your filter in ${activeMonthData.meta.label}.`
                      : "No tickets found matching your filter."}
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
