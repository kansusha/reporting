import { describe, expect, it } from "vitest";

import { dayInZone, isInWindow, sprintWorklogWindow } from "./worklog-window";

describe("dayInZone", () => {
  it("uses the Jira user's zone, not UTC", () => {
    // 20:00 UTC on Sep 14 is already Sep 15 in India.
    expect(dayInZone("2026-09-14T20:00:00.000Z", "Asia/Kolkata")).toBe("2026-09-15");
    expect(dayInZone("2026-09-14T20:00:00.000Z", "UTC")).toBe("2026-09-14");
  });

  it("reads Jira's +hhmm worklog offsets", () => {
    expect(dayInZone("2026-09-15T09:00:00.000+0530", "Asia/Kolkata")).toBe("2026-09-15");
  });
});

describe("sprintWorklogWindow", () => {
  const tz = "Asia/Kolkata";

  it("closed sprint: start day to planned end day", () => {
    expect(
      sprintWorklogWindow(
        {
          state: "closed",
          startDate: "2026-09-01T04:30:00.000Z",
          endDate: "2026-09-14T12:00:00.000Z",
          completeDate: "2026-09-14T10:00:00.000Z",
        },
        tz,
      ),
    ).toEqual({ from: "2026-09-01", to: "2026-09-14", timeZone: tz });
  });

  it("closed late: extends to the completion day", () => {
    expect(
      sprintWorklogWindow(
        {
          state: "closed",
          startDate: "2026-09-01T04:30:00.000Z",
          endDate: "2026-09-14T12:00:00.000Z",
          completeDate: "2026-09-16T10:00:00.000Z",
        },
        tz,
      )?.to,
    ).toBe("2026-09-16");
  });

  it("active sprint past its planned end: extends to today", () => {
    expect(
      sprintWorklogWindow(
        {
          state: "active",
          startDate: "2026-09-15T04:30:00.000Z",
          endDate: "2026-09-28T12:00:00.000Z",
        },
        tz,
        Date.parse("2026-10-01T06:00:00.000Z"),
      )?.to,
    ).toBe("2026-10-01");
  });

  it("no start date: no window", () => {
    expect(sprintWorklogWindow({ state: "future" }, tz)).toBeNull();
  });
});

describe("isInWindow", () => {
  const window = { from: "2026-09-15", to: "2026-09-28", timeZone: "Asia/Kolkata" };
  it("includes both boundary days in full", () => {
    expect(isInWindow("2026-09-15T00:10:00.000+0530", window)).toBe(true);
    expect(isInWindow("2026-09-28T23:50:00.000+0530", window)).toBe(true);
  });
  it("excludes the days outside", () => {
    expect(isInWindow("2026-09-14T23:50:00.000+0530", window)).toBe(false);
    expect(isInWindow("2026-09-29T00:10:00.000+0530", window)).toBe(false);
  });
});
