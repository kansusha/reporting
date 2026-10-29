/**
 * Recharts-based chart components for sprint reporting.
 * Colors come from CSS custom properties so they automatically adapt to
 * light/dark mode.  Two fixed series are used: "current" (teal) and
 * "previous/baseline" (blue), matching --chart-current / --chart-previous.
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// ---------------------------------------------------------------------------
// Design-system tokens (read at runtime so dark-mode flips automatically)
// ---------------------------------------------------------------------------
function cssVar(name: string): string {
  if (typeof window === "undefined") return "#888";
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

const C = {
  get current() { return cssVar("--chart-current") || "#1baf7a"; },
  get previous() { return cssVar("--chart-previous") || "#2a78d6"; },
  get grid() { return cssVar("--chart-grid") || "#e1e0d9"; },
  get axis() { return cssVar("--chart-axis") || "#c3c2b7"; },
  // Status palette — fixed identity order
  todo:       "#9ca3af",  // gray
  inProgress: "#e6a817",  // amber
  completed:  "#2a78d6",  // blue (same as previous)
  deployed:   "#1baf7a",  // teal (same as current)
};

// ---------------------------------------------------------------------------
// Shared tooltip style
// ---------------------------------------------------------------------------
const TOOLTIP_STYLE: React.CSSProperties = {
  background: "var(--tooltip-bg, hsl(var(--background)))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 6,
  fontSize: 11,
  color: "hsl(var(--foreground))",
  padding: "6px 10px",
  boxShadow: "0 2px 8px hsl(var(--foreground)/0.08)",
};
const CURSOR_STYLE = { fill: "hsl(var(--muted))", opacity: 0.5 };

// ---------------------------------------------------------------------------
// Monthly points bar chart — committed vs completed per month
// ---------------------------------------------------------------------------
interface MonthlyPointsDatum {
  label: string;     // "Jan", "Feb", …
  key: string;       // "2026-01"
  committed: number;
  completed: number;
  isCurrent?: boolean;
}

export function MonthlyPointsChart({
  months,
  onClickMonth,
}: {
  months: MonthlyPointsDatum[];
  onClickMonth?: (key: string) => void;
}) {
  // Only show months that have any data to avoid a sea of zeros
  const data = months.filter((m) => m.committed > 0 || m.completed > 0);
  if (data.length === 0) {
    return <ChartEmpty message="No story-point data yet — run Sync now." />;
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} barCategoryGap="28%" barGap={2} onClick={(e) => {
        if (e?.activePayload?.[0] && onClickMonth) {
          onClickMonth((e.activePayload[0].payload as MonthlyPointsDatum).key);
        }
      }}>
        <CartesianGrid vertical={false} stroke={C.grid} strokeDasharray="0" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: C.axis }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 10, fill: C.axis }}
          axisLine={false}
          tickLine={false}
          width={28}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={CURSOR_STYLE}
          formatter={(val: number, name: string) => [
            `${val} pts`,
            name === "committed" ? "Committed" : "Completed",
          ]}
        />
        <Legend
          iconType="square"
          iconSize={8}
          wrapperStyle={{ fontSize: 10, paddingTop: 8 }}
          formatter={(v) => v === "committed" ? "Committed" : "Completed"}
        />
        <Bar dataKey="committed" fill={C.previous} radius={[3, 3, 0, 0]} maxBarSize={28}>
          {data.map((entry) => (
            <Cell
              key={entry.key}
              fill={C.previous}
              opacity={entry.isCurrent ? 1 : 0.55}
            />
          ))}
        </Bar>
        <Bar dataKey="completed" fill={C.current} radius={[3, 3, 0, 0]} maxBarSize={28}>
          {data.map((entry) => (
            <Cell
              key={entry.key}
              fill={C.current}
              opacity={entry.isCurrent ? 1 : 0.7}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Quarterly points bar chart — committed vs completed per quarter
// ---------------------------------------------------------------------------
interface QuarterlyPointsDatum {
  label: string;     // "Q3 2026"
  key: string;       // "2026-Q3"
  committed: number;
  completed: number;
  isCurrent?: boolean;
}

export function QuarterlyPointsChart({
  quarters,
  onClickQuarter,
}: {
  quarters: QuarterlyPointsDatum[];
  onClickQuarter?: (key: string) => void;
}) {
  const data = quarters.filter((q) => q.committed > 0 || q.completed > 0);
  if (data.length === 0) {
    return <ChartEmpty message="No story-point data yet — run Sync now." />;
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} barCategoryGap="32%" barGap={2} onClick={(e) => {
        if (e?.activePayload?.[0] && onClickQuarter) {
          onClickQuarter((e.activePayload[0].payload as QuarterlyPointsDatum).key);
        }
      }}>
        <CartesianGrid vertical={false} stroke={C.grid} strokeDasharray="0" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: C.axis }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 10, fill: C.axis }}
          axisLine={false}
          tickLine={false}
          width={28}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={CURSOR_STYLE}
          formatter={(val: number, name: string) => [
            `${val} pts`,
            name === "committed" ? "Committed" : "Completed",
          ]}
        />
        <Legend
          iconType="square"
          iconSize={8}
          wrapperStyle={{ fontSize: 10, paddingTop: 8 }}
          formatter={(v) => v === "committed" ? "Committed" : "Completed"}
        />
        <Bar dataKey="committed" fill={C.previous} radius={[3, 3, 0, 0]} maxBarSize={36}>
          {data.map((entry) => (
            <Cell key={entry.key} fill={C.previous} opacity={entry.isCurrent ? 1 : 0.55} />
          ))}
        </Bar>
        <Bar dataKey="completed" fill={C.current} radius={[3, 3, 0, 0]} maxBarSize={36}>
          {data.map((entry) => (
            <Cell key={entry.key} fill={C.current} opacity={entry.isCurrent ? 1 : 0.7} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Team performance — horizontal bar chart (committed vs completed per member)
// ---------------------------------------------------------------------------
interface TeamDatum {
  name: string;
  committed: number;
  completed: number;
}

export function TeamPerformanceChart({ team }: { team: TeamDatum[] }) {
  const data = [...team]
    .sort((a, b) => b.committed - a.committed)
    .slice(0, 12); // cap at 12 rows to stay readable

  if (data.length === 0) {
    return <ChartEmpty message="No team data for this period." />;
  }

  const rowH = 28;
  const height = Math.max(120, data.length * rowH + 60);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout="vertical"
        barCategoryGap="22%"
        barGap={2}
        margin={{ left: 0, right: 16, top: 4, bottom: 4 }}
      >
        <CartesianGrid horizontal={false} stroke={C.grid} />
        <XAxis
          type="number"
          tick={{ fontSize: 10, fill: C.axis }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fontSize: 10, fill: C.axis }}
          axisLine={false}
          tickLine={false}
          width={90}
          tickFormatter={(v: string) => v.length > 14 ? v.slice(0, 13) + "…" : v}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={CURSOR_STYLE}
          formatter={(val: number, name: string) => [
            `${val} pts`,
            name === "committed" ? "Committed" : "Completed",
          ]}
        />
        <Legend
          iconType="square"
          iconSize={8}
          wrapperStyle={{ fontSize: 10, paddingTop: 8 }}
          formatter={(v) => v === "committed" ? "Committed" : "Completed"}
        />
        <Bar dataKey="committed" fill={C.previous} radius={[0, 3, 3, 0]} maxBarSize={14} />
        <Bar dataKey="completed" fill={C.current} radius={[0, 3, 3, 0]} maxBarSize={14} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Status breakdown — pie / donut
// ---------------------------------------------------------------------------
interface StatusDatum {
  name: string;
  value: number;
  color: string;
}

const STATUS_META = [
  { key: "deployed",    label: "Deployed",    color: C.deployed },
  { key: "completed",   label: "Completed",   color: C.completed },
  { key: "in-progress", label: "In Progress", color: C.inProgress },
  { key: "todo",        label: "To Do",       color: C.todo },
] as const;

export function StatusBreakdownChart({
  buckets,
}: {
  buckets: Record<string, number>;
}) {
  const data: StatusDatum[] = STATUS_META
    .map((s) => ({ name: s.label, value: buckets[s.key] ?? 0, color: s.color }))
    .filter((d) => d.value > 0);

  if (data.length === 0) {
    return <ChartEmpty message="No tickets in this period." />;
  }

  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={52}
          outerRadius={80}
          paddingAngle={2}
          strokeWidth={2}
          stroke="hsl(var(--background))"
        >
          {data.map((entry) => (
            <Cell key={entry.name} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={(val: number, name: string) => [
            `${val} (${Math.round((val / total) * 100)}%)`,
            name,
          ]}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 10, paddingTop: 4 }}
          formatter={(v) => `${v} · ${data.find((d) => d.name === v)?.value ?? 0}`}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Logged hours per member — horizontal bar
// ---------------------------------------------------------------------------
interface HoursDatum {
  name: string;
  hours: number;
}

export function LoggedHoursChart({ team }: { team: HoursDatum[] }) {
  const data = [...team]
    .filter((m) => m.hours > 0)
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 12);

  if (data.length === 0) {
    return <ChartEmpty message="No logged hours for this period." />;
  }

  const rowH = 28;
  const height = Math.max(120, data.length * rowH + 60);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ left: 0, right: 16, top: 4, bottom: 4 }}
      >
        <CartesianGrid horizontal={false} stroke={C.grid} />
        <XAxis
          type="number"
          tick={{ fontSize: 10, fill: C.axis }}
          axisLine={false}
          tickLine={false}
          unit=" h"
        />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fontSize: 10, fill: C.axis }}
          axisLine={false}
          tickLine={false}
          width={90}
          tickFormatter={(v: string) => v.length > 14 ? v.slice(0, 13) + "…" : v}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={CURSOR_STYLE}
          formatter={(val: number) => [`${val} h`, "Logged"]}
        />
        <Bar dataKey="hours" fill={C.current} radius={[0, 3, 3, 0]} maxBarSize={14} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Empty state placeholder
// ---------------------------------------------------------------------------
function ChartEmpty({ message }: { message: string }) {
  return (
    <div className="flex h-[160px] items-center justify-center text-xs text-muted-foreground">
      {message}
    </div>
  );
}
