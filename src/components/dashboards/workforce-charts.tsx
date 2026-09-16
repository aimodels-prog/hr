import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { RefreshCw } from "lucide-react";
import { useCurrentUser } from "@/lib/auth";
import { getWorkforceAnalyticsFn } from "@/lib/server-functions/workforce-analytics.server";
import { ChartContainer } from "@/components/ui/chart";
import { Button } from "@/components/ui/button";

const colors = {
  worked: "#0d9488",
  expected: "#2563eb",
  recorded: "#0d9488",
  review: "#d97706",
  missing: "#94a3b8",
  leaveDays: "#6366f1",
  count: "#2563eb",
};
const chartConfig = Object.fromEntries(
  Object.entries(colors).map(([key, color]) => [key, { color }]),
);
const shortDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const hours = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 });

function Panel({
  title,
  description,
  link,
  children,
}: {
  title: string;
  description: string;
  link?: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-xl border bg-card p-4 shadow-sm sm:p-5" aria-label={title}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        {link && (
          <Link to={link} className="shrink-0 text-xs font-medium text-primary hover:underline">
            View details
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

function CountChart({ data, label }: { data: { name: string; count: number }[]; label: string }) {
  if (!data.length)
    return (
      <p className="flex h-52 items-center justify-center text-sm text-muted-foreground">
        No records to display.
      </p>
    );
  return (
    <>
      <ChartContainer
        config={chartConfig}
        className="h-64 w-full aspect-auto"
        role="img"
        aria-label={label}
      >
        <BarChart data={data} layout="vertical" margin={{ left: 0, right: 20 }} accessibilityLayer>
          <CartesianGrid horizontal={false} />
          <XAxis type="number" allowDecimals={false} />
          <YAxis
            dataKey="name"
            type="category"
            width={105}
            tickFormatter={(name: string) => (name.length > 16 ? `${name.slice(0, 15)}…` : name)}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip />
          <Bar
            dataKey="count"
            name="Count"
            fill={colors.count}
            radius={[0, 4, 4, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ChartContainer>
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-muted-foreground">View chart data</summary>
        <table className="mt-2 w-full text-left">
          <caption className="sr-only">{label}</caption>
          <thead>
            <tr>
              <th scope="col">Category</th>
              <th scope="col">Count</th>
            </tr>
          </thead>
          <tbody>
            {data.map((item) => (
              <tr key={item.name}>
                <th scope="row" className="py-1 font-normal">
                  {item.name}
                </th>
                <td>{item.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}

export default function WorkforceCharts({ scope }: { scope: "self" | "hr" }) {
  const user = useCurrentUser();
  const [days, setDays] = useState<7 | 30>(30);
  const query = useQuery({
    queryKey: ["workforce-analytics", user.id, user.workspaceEmail, user.activeRole, scope, days],
    queryFn: () =>
      getWorkforceAnalyticsFn({
        data: {
          actorId: user.id,
          ...(user.workspaceEmail ? { actorEmail: user.workspaceEmail } : {}),
          activeRole: user.activeRole,
          scope,
          days,
        },
      }),
    enabled: typeof window !== "undefined",
    staleTime: 60_000,
    refetchInterval: 300_000,
    retry: false,
  });
  const data = query.data;
  const label = scope === "self" ? "My working hours" : "HR insights";
  const departmentData =
    data?.departments.length && data.departments.length > 8
      ? [
          ...data.departments.slice(0, 8),
          {
            name: "Other departments",
            count: data.departments.slice(8).reduce((sum, row) => sum + row.count, 0),
          },
        ]
      : (data?.departments ?? []);
  return (
    <section className="min-w-0 space-y-4" aria-label={label}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{label}</h2>
          <p className="text-xs text-muted-foreground">
            {data
              ? `${data.startDate} to ${data.endDate} · ${data.timezone}`
              : "Completed days only; today is excluded"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor={`chart-period-${scope}`}>
            Chart period
          </label>
          <select
            id={`chart-period-${scope}`}
            value={days}
            onChange={(event) => setDays(Number(event.target.value) as 7 | 30)}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            <option value={7}>Last 7 completed days</option>
            <option value={30}>Last 30 completed days</option>
          </select>
          <Button
            variant="outline"
            size="icon"
            aria-label={`Refresh ${label}`}
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw className={`h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>
      {query.isPending && (
        <p role="status" className="rounded-xl border p-6 text-sm text-muted-foreground">
          Loading attendance charts…
        </p>
      )}
      {query.isError && (
        <p role="alert" className="rounded-xl border p-4 text-sm">
          Charts could not be loaded. {query.error.message}{" "}
          <button className="text-primary underline" onClick={() => void query.refetch()}>
            Try again
          </button>
        </p>
      )}
      {data && !query.isError && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { name: "Recorded hours", value: `${hours(data.totals.worked)} h` },
              { name: "Policy expected", value: `${hours(data.totals.expected)} h` },
              {
                name: "Difference",
                value: `${hours(data.totals.worked - data.totals.expected)} h`,
              },
              {
                name: "Days needing review",
                value: String(data.totals.review + data.totals.missing),
              },
            ].map((metric) => (
              <div key={metric.name} className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">{metric.name}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{metric.value}</p>
              </div>
            ))}
          </div>
          {data.totals.review + data.totals.missing > 0 && (
            <p className="text-xs text-muted-foreground">
              This comparison is incomplete until missing punches and pending records are reviewed.
              The difference is not a confirmed absence or salary deduction.
            </p>
          )}
          <div className={scope === "hr" ? "grid min-w-0 gap-4 xl:grid-cols-2" : "min-w-0"}>
            <Panel
              title="Worked hours vs expected hours"
              description="Recorded, completed attendance—including approved site duty—against the working-calendar expectation."
              link={scope === "hr" ? "/staff/attendance" : "/staff/me/attendance"}
            >
              <ChartContainer
                config={chartConfig}
                className="h-64 w-full aspect-auto"
                role="img"
                aria-label="Daily recorded hours compared with expected hours"
              >
                <ComposedChart data={data.days} margin={{ left: -18, right: 8 }} accessibilityLayer>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={24} />
                  <YAxis />
                  <Tooltip labelFormatter={(date) => String(date)} />
                  <Legend />
                  <Bar
                    name="Recorded hours"
                    dataKey="worked"
                    fill={colors.worked}
                    radius={[3, 3, 0, 0]}
                    isAnimationActive={false}
                  />
                  <Line
                    name="Expected hours"
                    dataKey="expected"
                    stroke={colors.expected}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ChartContainer>
              {data.totals.worked === 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  No completed attendance hours recorded in this period.
                </p>
              )}
            </Panel>
            {scope === "hr" && (
              <>
                <Panel
                  title="Attendance coverage"
                  description="Employee-days with expected work: completed records, pending review, or no confirmed record. Missing data is not a finding of absence."
                  link="/staff/attendance"
                >
                  <ChartContainer
                    config={chartConfig}
                    className="h-64 w-full aspect-auto"
                    role="img"
                    aria-label="Daily employee attendance coverage"
                  >
                    <BarChart data={data.days} margin={{ left: -18, right: 8 }} accessibilityLayer>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={24} />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Legend />
                      <Bar
                        name="Recorded"
                        dataKey="recorded"
                        stackId="attendance"
                        fill={colors.recorded}
                        isAnimationActive={false}
                      />
                      <Bar
                        name="Pending review"
                        dataKey="review"
                        stackId="attendance"
                        fill={colors.review}
                        isAnimationActive={false}
                      />
                      <Bar
                        name="No confirmed record"
                        dataKey="missing"
                        stackId="attendance"
                        fill={colors.missing}
                        isAnimationActive={false}
                      />
                    </BarChart>
                  </ChartContainer>
                </Panel>
                <Panel
                  title="Employees by department"
                  description={`Current headcount: ${data.departments.reduce((sum, row) => sum + row.count, 0)}. Department assignments reflect current profiles, not historical changes.`}
                  link="/staff/employees"
                >
                  <CountChart data={departmentData} label="Current employees by department" />
                </Panel>
                <Panel
                  title="Approved leave trend"
                  description="Approved leave in working-day equivalents; a half-day counts as 0.5. Weekends and applicable holidays are excluded."
                  link="/staff/leave-admin"
                >
                  <ChartContainer
                    config={chartConfig}
                    className="h-64 w-full aspect-auto"
                    role="img"
                    aria-label="Daily approved leave days"
                  >
                    <AreaChart data={data.days} margin={{ left: -18, right: 8 }} accessibilityLayer>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={24} />
                      <YAxis />
                      <Tooltip />
                      <Area
                        name="Approved leave days"
                        dataKey="leaveDays"
                        stroke={colors.leaveDays}
                        fill={colors.leaveDays}
                        fillOpacity={0.15}
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ChartContainer>
                </Panel>
                <Panel
                  title="Recruitment pipeline"
                  description="Current application statuses for open vacancies, independent of the attendance date filter. Applications are counted—not unique people or stage conversions."
                  link="/staff/vacancies"
                >
                  <CountChart data={data.recruitment} label="Applications by recruitment status" />
                </Panel>
              </>
            )}
          </div>
          <details className="rounded-lg border p-3 text-xs">
            <summary className="cursor-pointer font-medium">
              Daily figures and calculation notes
            </summary>
            <p className="my-3 text-muted-foreground">
              Expected hours use the current policy ({hours(data.dailyHours)} h/day), working week,
              holidays, service dates and approved leave. Open punches, pending corrections and
              unconfirmed site visits do not count as completed hours. These charts are not payroll
              deductions or overtime approval. HR totals count employee-days, not unique employees.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <caption className="sr-only">Daily hours and attendance figures</caption>
                <thead>
                  <tr>
                    {[
                      "Date",
                      "Recorded h",
                      "Expected h",
                      "Recorded days",
                      "Pending review",
                      "No record",
                      "Leave days",
                    ].map((title) => (
                      <th scope="col" className="whitespace-nowrap px-2 py-1" key={title}>
                        {title}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.days.map((day) => (
                    <tr key={day.date} className="border-t">
                      <th scope="row" className="whitespace-nowrap px-2 py-1 font-normal">
                        {day.date}
                      </th>
                      {[
                        day.worked,
                        day.expected,
                        day.recorded,
                        day.review,
                        day.missing,
                        day.leaveDays,
                      ].map((value, index) => (
                        <td key={index} className="px-2 py-1 tabular-nums">
                          {hours(value)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
