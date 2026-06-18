import { Link, data, isRouteErrorResponse } from "react-router";
import type { Route } from "./+types/admin.analytics";
import { getCurrentUserId } from "~/lib/session";
import { getUserById } from "~/services/userService";
import { getAllCourses } from "~/services/courseService";
import {
  getRevenueSummary,
  getEnrollmentCount,
  getTopEarningCourse,
  getRevenueTimeSeries,
} from "~/services/analyticsService";
import { UserRole } from "~/db/schema";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import {
  AlertTriangle,
  DollarSign,
  Users,
  Trophy,
  BarChart3,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { formatCents } from "~/lib/utils";
import { resolveRange, PRESET_LABELS, type RangePreset } from "~/lib/analytics";

export function meta() {
  return [
    { title: "Platform Analytics — Cadence" },
    {
      name: "description",
      content: "Platform-wide revenue and enrollment analytics",
    },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to view analytics.", {
      status: 401,
    });
  }

  const user = getUserById(currentUserId);

  if (!user || user.role !== UserRole.Admin) {
    throw data("Only admins can access platform analytics.", { status: 403 });
  }

  // Platform scope: every course, across all instructors.
  const courseIds = getAllCourses().map((course) => course.id);

  const range = resolveRange(new URL(request.url).searchParams);

  const period = getRevenueSummary({
    courseIds,
    from: range.from,
    to: range.to,
  });
  const enrollmentCount = getEnrollmentCount({
    courseIds,
    from: range.from,
    to: range.to,
  });
  const topCourse = getTopEarningCourse({
    courseIds,
    from: range.from,
    to: range.to,
  });
  const timeSeries = getRevenueTimeSeries({
    courseIds,
    from: range.from,
    to: range.to,
  });

  return {
    range: {
      preset: range.preset,
    },
    totalRevenue: period.totalRevenue,
    totalEnrollments: enrollmentCount,
    topCourse,
    timeSeries,
  };
}

const PRESETS: RangePreset[] = ["7d", "30d", "90d", "all"];

function Kpi({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: LucideIcon;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <span className="text-sm font-medium text-muted-foreground">
          {label}
        </span>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="truncate text-3xl font-bold">{value}</div>
        {sub && (
          <div className="mt-1 truncate text-sm text-muted-foreground">
            {sub}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface TimePoint {
  label: string;
  periodStart: string;
  revenue: number;
  transactions: number;
}

function RevenueOverTimeTable({ points }: { points: TimePoint[] }) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Period
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Revenue
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Sales
                </th>
              </tr>
            </thead>
            <tbody>
              {points.length === 0 && (
                <tr>
                  <td
                    colSpan={3}
                    className="px-4 py-10 text-center text-sm text-muted-foreground"
                  >
                    No sales in the selected period.
                  </td>
                </tr>
              )}
              {points.map((point) => (
                <tr
                  key={point.periodStart}
                  className="border-b border-border last:border-0"
                >
                  <td className="px-4 py-3 text-sm font-medium">
                    {point.label}
                  </td>
                  <td className="px-4 py-3 text-right text-sm">
                    {formatCents(point.revenue)}
                  </td>
                  <td className="px-4 py-3 text-right text-sm">
                    {point.transactions}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <Skeleton className="h-9 w-56" />
      <Skeleton className="mt-2 h-5 w-80" />
      <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    </div>
  );
}

export default function AdminAnalytics({ loaderData }: Route.ComponentProps) {
  const { range, totalRevenue, totalEnrollments, topCourse, timeSeries } =
    loaderData;
  const periodLabel = PRESET_LABELS[range.preset as RangePreset] ?? "Selected";
  const hasData = totalRevenue > 0 || totalEnrollments > 0;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Platform Analytics</span>
      </nav>

      <div className="mb-6">
        <h1 className="text-3xl font-bold">Platform Analytics</h1>
        <p className="mt-1 text-muted-foreground">
          Revenue and enrollments across every course and instructor
        </p>
      </div>

      {/* Time period selector */}
      <div className="mb-8 flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <Link key={preset} to={`?preset=${preset}`} preventScrollReset>
            <Button
              type="button"
              size="sm"
              variant={range.preset === preset ? "default" : "outline"}
            >
              {PRESET_LABELS[preset]}
            </Button>
          </Link>
        ))}
      </div>

      {hasData ? (
        <>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <Kpi
              label={`Total revenue · ${periodLabel}`}
              value={formatCents(totalRevenue)}
              icon={DollarSign}
            />
            <Kpi
              label={`Total enrollments · ${periodLabel}`}
              value={String(totalEnrollments)}
              icon={Users}
            />
            <Kpi
              label="Top earning course"
              value={topCourse ? topCourse.title : "—"}
              sub={topCourse ? formatCents(topCourse.revenue) : "No sales yet"}
              icon={Trophy}
            />
          </div>

          <div className="mt-10">
            <h2 className="mb-1 text-xl font-semibold">Revenue over time</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              <TrendingUp className="mr-1 inline-block size-4" />
              {periodLabel} · combined across all courses
            </p>
            <RevenueOverTimeTable points={timeSeries} />
          </div>
        </>
      ) : (
        <Card>
          <CardContent className="py-16 text-center">
            <BarChart3 className="mx-auto mb-4 size-10 text-muted-foreground/50" />
            <p className="text-lg font-medium">No data for this period</p>
            <p className="mt-1 text-sm text-muted-foreground">
              There are no sales or enrollments in {periodLabel.toLowerCase()}.
              Try a wider time range.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading analytics.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "Access denied";
      message =
        typeof error.data === "string"
          ? error.data
          : "Only admins can access this page.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <div className="flex items-center justify-center gap-3">
          <Link to="/">
            <Button>Go Home</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
