// Work log reporting matches how Timela (and Jira's own worklogDate JQL)
// count time: by calendar day in the Jira user's time zone, over a date
// range — not by exact timestamps. Timela stores its entries as native Jira
// worklogs, so the same day-based window over the board's projects gives
// the same totals as a Timela timesheet for the sprint's dates.

export interface WorklogWindow {
  from: string; // YYYY-MM-DD, inclusive
  to: string; // YYYY-MM-DD, inclusive
  timeZone: string;
}

export function dayInZone(value: string | number, timeZone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

// Sprint start day → planned end day (or the completion day if it closed
// late). An active sprint that's run past its planned end extends to today.
export function sprintWorklogWindow(
  sprint: {
    state: string;
    startDate?: string | null;
    endDate?: string | null;
    completeDate?: string | null;
  },
  timeZone: string,
  now: number = Date.now(),
): WorklogWindow | null {
  if (!sprint.startDate) return null;
  const today = dayInZone(now, timeZone);
  const from = dayInZone(sprint.startDate, timeZone);
  const candidates = [
    sprint.endDate ? dayInZone(sprint.endDate, timeZone) : "",
    sprint.state === "closed" && sprint.completeDate
      ? dayInZone(sprint.completeDate, timeZone)
      : "",
    sprint.state === "active" ? today : "",
  ].filter(Boolean);
  const to = candidates.sort()[candidates.length - 1] ?? today;
  return { from, to, timeZone };
}

export function isInWindow(started: string, window: WorklogWindow): boolean {
  const day = dayInZone(started, window.timeZone);
  return day >= window.from && day <= window.to;
}
