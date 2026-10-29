import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readAppState: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: mocks.readAppState,
}));

import action from "./view-screen";

describe("view-screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the current navigation and sprint-reporting screen state when present", async () => {
    const state: Record<string, unknown> = {
      navigation: { view: "chat", threadId: "t1" },
      "sprint-reporting-screen": { page: "reports", view: "tickets" },
      "sprint-reporting-ticket-filter": { filter: "deployed" },
      "sprint-reporting-monthly-filter": { month: "current" },
      "sprint-reporting-team-filter": { period: "current", member: "mem1" },
    };
    mocks.readAppState.mockImplementation((key: string) =>
      Promise.resolve(state[key] ?? null),
    );

    const result = await action.run({});

    expect(mocks.readAppState).toHaveBeenCalledWith("navigation");
    expect(mocks.readAppState).toHaveBeenCalledWith("sprint-reporting-screen");
    expect(result).toEqual({
      navigation: { view: "chat", threadId: "t1" },
      sprintReportingScreen: { page: "reports", view: "tickets" },
      ticketFilter: { filter: "deployed" },
      monthlyFilter: { month: "current" },
      teamFilter: { period: "current", member: "mem1" },
    });
  });

  it("returns a fallback message when there is no navigation state", async () => {
    mocks.readAppState.mockResolvedValue(null);

    const result = await action.run({});

    expect(result).toBe("No application state found. Is the app running?");
  });

  it("is marked read-only", () => {
    expect(action.readOnly).toBe(true);
  });
});
