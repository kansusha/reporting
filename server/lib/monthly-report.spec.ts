import { describe, expect, it } from "vitest";

import {
  formatMonthMeta,
  getIssueMonthKey,
  getIssueMonthRole,
  getYearMonth,
  resolveTargetMonths,
} from "./monthly-report.js";

describe("monthly-report helpers", () => {
  it("extracts year-month format correctly", () => {
    expect(getYearMonth("2026-10-05T11:00:00.000Z")).toBe("2026-10");
    expect(getYearMonth("2026-09-15T08:30:00+05:30")).toBe("2026-09");
    expect(getYearMonth(null)).toBe(null);
    expect(getYearMonth("invalid-date")).toBe(null);
  });

  it("assigns issues to current or previous month role or excludes them", () => {
    const currentKey = "2026-10";
    const prevKey = "2026-09";

    // Done issue resolved in current month
    const doneCurrent = {
      statusCategory: "done",
      resolvedAt: "2026-10-02T10:00:00.000Z",
      createdAt: "2025-05-01T10:00:00.000Z",
      updatedAt: "2026-10-02T10:00:00.000Z",
    } as any;
    expect(getIssueMonthRole(doneCurrent, currentKey, prevKey)).toBe("current");

    // Done issue resolved in previous month
    const donePrev = {
      statusCategory: "done",
      resolvedAt: "2026-09-28T10:00:00.000Z",
      createdAt: "2024-01-01T10:00:00.000Z",
      updatedAt: "2026-09-28T10:00:00.000Z",
    } as any;
    expect(getIssueMonthRole(donePrev, currentKey, prevKey)).toBe("previous");

    // Done issue resolved in 2025 (MUST BE EXCLUDED)
    const doneOld = {
      statusCategory: "done",
      resolvedAt: "2025-09-28T10:00:00.000Z",
      createdAt: "2024-01-01T10:00:00.000Z",
      updatedAt: "2026-09-28T10:00:00.000Z",
    } as any;
    expect(getIssueMonthRole(doneOld, currentKey, prevKey)).toBe(null);

    // Open issue created in current month
    const openCurrent = {
      statusCategory: "indeterminate",
      resolvedAt: null,
      createdAt: "2026-10-01T12:00:00.000Z",
      updatedAt: "2026-10-02T12:00:00.000Z",
    } as any;
    expect(getIssueMonthRole(openCurrent, currentKey, prevKey)).toBe("current");

    // Open issue created in 2024 with no update in current/previous month (MUST BE EXCLUDED)
    const openOld = {
      statusCategory: "new",
      resolvedAt: null,
      createdAt: "2024-05-10T12:00:00.000Z",
      updatedAt: "2024-06-01T12:00:00.000Z",
    } as any;
    expect(getIssueMonthRole(openOld, currentKey, prevKey)).toBe(null);
  });

  it("resolves target months appropriately", () => {
    const issues = [
      {
        resolvedAt: "2026-10-01T12:00:00Z",
        createdAt: "2026-09-15T12:00:00Z",
      },
    ] as any;
    const sprints = [] as any;

    const result = resolveTargetMonths(issues, sprints);
    expect(result.current.key).toBeDefined();
    expect(result.previous.key).toBeDefined();
    expect(result.current.year).toBeGreaterThanOrEqual(2024);
  });

  it("formats MonthMeta with full and short month names", () => {
    const meta = formatMonthMeta(2026, 0, 5);
    expect(meta.key).toBe("2026-01");
    expect(meta.monthName).toBe("January");
    expect(meta.shortMonthName).toBe("Jan");
    expect(meta.label).toBe("January 2026");
    expect(meta.shortLabel).toBe("Jan 2026");
    expect(meta.hasData).toBe(true);
    expect(meta.issueCount).toBe(5);
  });
});
