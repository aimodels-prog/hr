import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/lib/auth";
import { getWorkforceAnalyticsFn } from "@/lib/server-functions/workforce-analytics.server";
import { WeeklyGoalCard } from "./weekly-goal-card";

export function WeeklyAttendanceOverview({ employeeId }: { employeeId: string }) {
  const user = useCurrentUser();
  const query = useQuery({
    queryKey: [
      "workforce-analytics",
      user.id,
      user.workspaceEmail,
      user.activeRole,
      "self",
      30,
      undefined,
    ],
    queryFn: () =>
      getWorkforceAnalyticsFn({
        data: {
          actorId: user.id,
          ...(user.workspaceEmail ? { actorEmail: user.workspaceEmail } : {}),
          activeRole: user.activeRole,
          scope: "self",
          days: 30,
        },
      }),
    enabled: typeof window !== "undefined",
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 2,
  });

  if (query.data) return <WeeklyGoalCard data={query.data} employeeId={employeeId} />;
  if (query.isError)
    return (
      <section
        aria-label="My weekly attendance goal"
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#b9d9ef] bg-[#edf6fc] px-5 py-4 text-sm dark:border-[#355c78] dark:bg-[#193149]"
      >
        <span>Weekly attendance is temporarily unavailable.</span>
        <button
          className="font-semibold text-primary underline-offset-4 hover:underline"
          onClick={() => query.refetch()}
        >
          Try again
        </button>
      </section>
    );
  return (
    <div
      role="status"
      aria-label="Loading weekly attendance"
      className="h-44 animate-pulse rounded-2xl border border-[#b9d9ef] bg-[#edf6fc] dark:border-[#355c78] dark:bg-[#193149]"
    />
  );
}
