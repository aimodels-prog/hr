import { type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  Pie,
  PieChart,
  Cell,
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
import type { LeaveChartRow } from "@/lib/data/dashboard-priorities";
import type { DashboardChartsProps } from "./dashboard-charts";

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

function CountChart({
  data,
  label,
  donut = false,
}: {
  data: { name: string; count: number }[];
  label: string;
  donut?: boolean;
}) {
  if (!data.length)
    return (
      <p className="flex h-52 items-center justify-center text-sm text-muted-foreground">
        No records to display.
      </p>
    );
  return (
    <>
      {donut && data.some((row) => row.count > 0) ? (
        <>
          <ChartContainer
            config={chartConfig}
            className="h-56 w-full aspect-auto"
            role="img"
            aria-label={label}
          >
            <PieChart>
              <Tooltip />
              <Pie
                data={data}
                dataKey="count"
                nameKey="name"
                innerRadius={55}
                outerRadius={85}
                isAnimationActive={false}
              >
                {data.map((row, index) => (
                  <Cell
                    key={row.name}
                    fill={[colors.recorded, colors.review, colors.missing, colors.count][index % 4]}
                  />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>
          <ul
            className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs"
            aria-label={`${label} legend`}
          >
            {data.map((row, index) => (
              <li key={row.name} className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-3 w-3 rounded-full"
                  style={{
                    backgroundColor: [colors.recorded, colors.review, colors.missing, colors.count][
                      index % 4
                    ],
                  }}
                />
                {row.name}: {row.count}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <ChartContainer
          config={chartConfig}
          className="w-full aspect-auto"
          style={{ height: Math.max(256, data.length * 32) }}
          role="img"
          aria-label={label}
        >
          <BarChart
            data={data}
            layout="vertical"
            margin={{ left: 0, right: 20 }}
            accessibilityLayer
          >
            <CartesianGrid horizontal={false} />
            <XAxis type="number" allowDecimals={false} />
            <YAxis
              dataKey="name"
              type="category"
              width={150}
              tick={{ fontSize: 11 }}
              tickFormatter={(name: string) => (name.length > 25 ? `${name.slice(0, 24)}…` : name)}
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
      )}
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

function LeaveChart({ rows }: { rows: LeaveChartRow[] }) {
  if (!rows.length)
    return (
      <p className="py-10 text-sm text-muted-foreground">
        No annual leave balance has been recorded for this leave year. HR can confirm the
        entitlement.
      </p>
    );
  return (
    <>
      <ChartContainer
        config={chartConfig}
        className="h-64 w-full aspect-auto"
        role="img"
        aria-label="Annual leave used booked remaining and carryover"
      >
        <BarChart data={rows} margin={{ left: -18, right: 8 }} accessibilityLayer>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="name" />
          <YAxis />
          <Tooltip />
          <Legend />
          <Bar dataKey="used" name="Used days" fill="#2563eb" isAnimationActive={false} />
          <Bar dataKey="booked" name="Booked days" fill="#6366f1" isAnimationActive={false} />
          <Bar dataKey="remaining" name="Remaining days" fill="#0d9488" isAnimationActive={false} />
          <Bar dataKey="carry" name="Carryover estimate" fill="#d97706" isAnimationActive={false} />
        </BarChart>
      </ChartContainer>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">Annual leave figures in days</caption>
          <thead>
            <tr>
              {["Leave", "Used", "Booked", "Remaining", "Carryover estimate"].map((name) => (
                <th key={name} scope="col" className="p-1">
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <th scope="row" className="p-1 font-normal">
                  {row.name}
                </th>
                {[row.used, row.booked, row.remaining, row.carry].map((value, index) => (
                  <td key={index} className="p-1">
                    {hours(value)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function WorkforceCharts({ scope, employeeId, profileId }: DashboardChartsProps) {
  const user = useCurrentUser();
  const location = useLocation();
  const navigate = useNavigate();
  const days: 7 | 30 = Number((location.search as { days?: number }).days) === 7 ? 7 : 30;
  const setDays = (value: 7 | 30) => {
    void navigate({ to: ".", search: (previous) => ({ ...previous, days: value }), replace: true });
  };
  const query = useQuery({
    queryKey: [
      "workforce-analytics",
      user.id,
      user.workspaceEmail,
      user.activeRole,
      scope,
      days,
      employeeId,
    ],
    queryFn: () =>
      getWorkforceAnalyticsFn({
        data: {
          actorId: user.id,
          ...(user.workspaceEmail ? { actorEmail: user.workspaceEmail } : {}),
          activeRole: user.activeRole,
          scope,
          days,
          employeeId,
        },
      }),
    enabled: typeof window !== "undefined",
    staleTime: 60_000,
    refetchInterval: 300_000,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
  });
  const data = query.data;
  const label =
    scope === "self" ? "My working hours" : employeeId ? "Employee insights" : "HR insights";
  const detail = (section: string, fallback: string) =>
    profileId
      ? `/staff/employees/${encodeURIComponent(profileId)}?days=${days}&from=${data?.startDate ?? ""}&until=${data?.endDate ?? ""}#${section}`
      : fallback;
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
      {query.isError && !data && (
        <div role="alert" className="space-y-3 rounded-xl border p-4 text-sm">
          <p>Charts are temporarily unavailable. Your attendance records have not been changed.</p>
          <p className="text-muted-foreground">
            Try again. If this page was open during an update, reload it to use the latest version.
            If your session has expired, you will be asked to sign in again.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              {query.isFetching ? "Retrying…" : "Try again"}
            </Button>
            <Button variant="outline" onClick={() => window.location.reload()}>
              Reload page
            </Button>
          </div>
        </div>
      )}
      {query.isError && data && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 text-sm"
        >
          <p>
            The latest refresh did not complete. Showing the last loaded figures
            {query.dataUpdatedAt
              ? ` (${new Date(query.dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})`
              : ""}
            .
          </p>
          <Button
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {query.isFetching ? "Retrying…" : "Retry refresh"}
          </Button>
        </div>
      )}
      {data && (
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
          <div
            className={scope === "hr" ? "grid min-w-0 gap-4 xl:grid-cols-2" : "min-w-0 space-y-4"}
            data-testid="primary-dashboard-charts"
          >
            <Panel
              title="Worked hours vs expected hours"
              description="Recorded, completed attendance—including approved site duty—against the working-calendar expectation."
              link={detail(
                "attendance",
                scope === "hr" ? "/staff/attendance" : "/staff/me/attendance",
              )}
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
            <Panel
              title={scope === "hr" ? "Leave usage and carryover" : "My annual leave balance"}
              description={`Leave year starting ${data.priorities.leaveYearStart}; independent of the attendance period. Used means approved days before today; booked means approved days from today onwards. Remaining is the recorded balance, already reduced for approved bookings.`}
              link={detail("leave", scope === "hr" ? "/staff/leave-admin" : "/staff/leave")}
            >
              <LeaveChart rows={data.priorities.annualLeave} />
              <p className="mt-3 text-xs text-muted-foreground">
                Carryover is an estimated part of remaining leave, not extra days. It uses the same
                oldest-leave-first calculation as reminders. Plan old leave before May and confirm
                the applicable deadline with HR. These figures do not grant leave eligibility or
                change balances.
              </p>
            </Panel>
            {scope === "self" && (
              <Panel
                title="My attendance summary"
                description="Completed working days, days needing review and days without a confirmed record for the selected period. Missing records do not automatically mean absence."
                link="/staff/me/attendance"
              >
                <CountChart
                  donut
                  label="My attendance record coverage"
                  data={[
                    {
                      name: "Completed records",
                      count: data.days.reduce((sum, day) => sum + day.recorded, 0),
                    },
                    { name: "Pending review", count: data.totals.review },
                    { name: "No confirmed record", count: data.totals.missing },
                  ]}
                />
              </Panel>
            )}
            {scope === "hr" && (
              <>
                <Panel
                  title="Attendance trend"
                  description="Employee-days with expected work: completed records, pending review, or no confirmed record. Missing data is not a finding of absence."
                  link={detail("attendance", "/staff/attendance")}
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
                  title="Approvals waiting"
                  description="Outstanding decisions by responsible role across leave, overtime, travel, training and visits. A travel request can need several decisions, so this is not a unique-request count. Independent of the attendance period."
                >
                  <CountChart
                    data={data.priorities.approvals}
                    label="Outstanding decisions by responsible role"
                  />
                  <nav
                    aria-label="Approval details"
                    className="mt-3 flex flex-wrap gap-3 text-xs text-primary underline"
                  >
                    <Link to={detail("leave", "/staff/leave-admin")}>Leave</Link>
                    <Link to={detail("attendance", "/staff/overtime-approvals")}>Overtime</Link>
                    <Link to={detail("travel", "/staff/travel-hr-approvals")}>Travel</Link>
                    <Link to={detail("training", "/staff/training")}>Training</Link>
                    <Link to={detail("attendance", "/staff/attendance")}>Visits</Link>
                  </nav>
                </Panel>
                <Panel
                  title="Upcoming document expiries"
                  description={
                    employeeId
                      ? "This employee’s current verified documents expiring within 90 days or overdue, including visa and insurance when recorded."
                      : "Current verified employee documents and published company documents with recorded expiry dates. Includes visas and insurance when recorded. Buckets are non-overlapping; due today is in 0–30 days. Independent of the attendance period."
                  }
                  link={detail("documents", "/staff/document-expiry")}
                >
                  <CountChart
                    data={data.priorities.expiries}
                    label="Documents overdue or expiring within 90 days"
                  />
                  {!employeeId && (
                    <Link
                      to="/staff/company-library"
                      className="mt-3 inline-block text-xs text-primary underline"
                    >
                      View company documents
                    </Link>
                  )}
                </Panel>
                {!employeeId && (
                  <Panel
                    title="Recruitment pipeline"
                    description="Current application statuses for open vacancies, independent of the attendance date filter. Applications are counted—not unique people or stage conversions."
                    link="/staff/vacancies"
                  >
                    <CountChart
                      data={data.recruitment}
                      label="Applications by recruitment status"
                    />
                  </Panel>
                )}
              </>
            )}
          </div>
          {scope === "hr" && (
            <section aria-label="Workforce and visit insights">
              <div className="mt-4 grid min-w-0 gap-4 xl:grid-cols-2">
                {!employeeId && (
                  <>
                    <Panel
                      title="Employees by department"
                      description="Current headcount by department; independent of the attendance period."
                      link="/staff/employees"
                    >
                      <CountChart data={departmentData} label="Current employees by department" />
                    </Panel>
                    <Panel
                      title="Employees by office"
                      description="Current headcount by assigned work location; independent of the attendance period."
                      link="/staff/employees"
                    >
                      <CountChart data={data.offices} label="Current employees by office" />
                    </Panel>
                    <Panel
                      title="Employment status"
                      description="Current employees by status, including probation and notice. This is not an attendance status."
                      link="/staff/employees"
                    >
                      <CountChart
                        donut
                        data={data.employmentStatuses}
                        label="Current employee employment statuses"
                      />
                    </Panel>
                  </>
                )}
                <Panel
                  title="Site and ministry visits"
                  description="Visit requests by their current status whose visit date falls in the selected completed-day period. Includes site, ministry and client visits."
                  link={detail("attendance", "/staff/attendance")}
                >
                  <CountChart data={data.visits} label="Visit requests by status" />
                </Panel>
              </div>
            </section>
          )}
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
