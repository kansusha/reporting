/**
 * See what the user is currently looking at on screen.
 *
 * Reads and returns the current navigation state from application state.
 *
 * Usage:
 *   pnpm action view-screen
 */

import { defineAction } from "@agent-native/core/action";
import { readAppState } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description:
    "See what the user is currently looking at on screen. Returns the current navigation state for the app canvas plus agent rail. Always call this first before taking any action.",
  schema: z.object({}),
  http: false,
  readOnly: true,
  run: async () => {
    const navigation = await readAppState("navigation");
    const sprintReportingScreen = await readAppState("sprint-reporting-screen");
    const ticketFilter = await readAppState("sprint-reporting-ticket-filter");
    const monthlyFilter = await readAppState("sprint-reporting-monthly-filter");
    const teamFilter = await readAppState("sprint-reporting-team-filter");

    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;
    if (sprintReportingScreen) screen.sprintReportingScreen = sprintReportingScreen;
    // Only meaningful while the Ticket details tab is open.
    if (ticketFilter) screen.ticketFilter = ticketFilter;
    // Only meaningful while the Monthly tracking tab is open.
    if (monthlyFilter) screen.monthlyFilter = monthlyFilter;
    // Only meaningful while the Team performance tab is open.
    if (teamFilter) screen.teamFilter = teamFilter;

    if (Object.keys(screen).length === 0) {
      return "No application state found. Is the app running?";
    }
    return screen;
  },
});
