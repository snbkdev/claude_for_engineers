import { Link, data, isRouteErrorResponse, useNavigate } from "react-router";
import type { Route } from "./+types/admin.analytics";
import { getCurrentUserId } from "~/lib/session";
import { getUserById, getUsersByRole } from "~/services/userService";
import { getAllCourses } from "~/services/courseService";
import {
  getRevenueSummary,
  getEnrollmentCount,
  getTopEarningCourse,
  getRevenueTimeSeries,
  getCourseBreakdown,
  type CourseBreakdownRow,
} from "~/services/analyticsService";
import { UserRole } from "~/db/schema";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
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
import { AnalyticsExport } from "~/components/analytics-export";

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
  const allCourses = getAllCourses();
  const courseIds = allCourses.map((course) => course.id);

  const searchParams = new URL(request.url).searchParams;
  const range = resolveRange(searchParams);

  const instructorIdParam = searchParams.get("instructorId");
  const selectedInstructorId = instructorIdParam
    ? Number(instructorIdParam)
    : null;

  const instructorIdsWithCourses = new Set(
    allCourses.map((course) => course.instructorId)
  );
  const instructors = getUsersByRole(UserRole.Instructor)
    .filter((instructor) => instructorIdsWithCourses.has(instructor.id))
    .map((instructor) => ({ id: instructor.id, name: instructor.name }));

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
  // The table is always grouped by month; the chart keeps auto granularity.
  const timeSeriesMonthly = getRevenueTimeSeries({
    courseIds,
    from: range.from,
    to: range.to,
    granularity: "monthly",
  });
  const courseBreakdown = getCourseBreakdown({
    courseIds,
    instructorId: selectedInstructorId,
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
    timeSeriesMonthly,
    instructors,
    selectedInstructorId,
    courseBreakdown,
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

function RevenueOverTimeChart({ points }: { points: TimePoint[] }) {
  const maxRevenue = Math.max(0, ...points.map((point) => point.revenue));

  if (points.length === 0 || maxRevenue === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No revenue to chart in the selected period.
        </CardContent>
      </Card>
    );
  }

  // A cycling palette so adjacent bars read as distinct, colorful bars.
  const BAR_GRADIENTS = [
    "from-violet-500 to-fuchsia-400",
    "from-sky-500 to-cyan-400",
    "from-emerald-500 to-teal-400",
    "from-amber-500 to-orange-400",
    "from-rose-500 to-pink-400",
    "from-indigo-500 to-blue-400",
  ];

  const totalRevenue = points.reduce((sum, point) => sum + point.revenue, 0);

  return (
    <Card>
      <CardContent className="p-6">
        <div className="mb-4 flex items-baseline justify-between">
          <span className="text-sm font-medium text-muted-foreground">
            Revenue per period
          </span>
          <span className="text-sm font-semibold">
            {formatCents(totalRevenue)} total
          </span>
        </div>
        <div className="flex h-64 items-stretch gap-2 overflow-x-auto pt-6">
          {points.map((point, index) => {
            const heightPct = (point.revenue / maxRevenue) * 100;
            const gradient = BAR_GRADIENTS[index % BAR_GRADIENTS.length];
            return (
              <div
                key={point.periodStart}
                className="group flex h-full min-w-[2.25rem] flex-1 flex-col items-center gap-2"
              >
                <div className="flex w-full flex-1 flex-col justify-end">
                  {/* Value label, revealed on hover */}
                  <span className="mb-1 text-center text-[10px] font-semibold tabular-nums text-foreground opacity-0 transition-opacity group-hover:opacity-100">
                    {formatCents(point.revenue)}
                  </span>
                  <div
                    className={`w-full rounded-t-md bg-gradient-to-t ${gradient} shadow-sm ring-1 ring-inset ring-white/10 transition-all duration-300 group-hover:brightness-110`}
                    style={{ height: `${Math.max(heightPct, 2)}%` }}
                    role="img"
                    aria-label={`${point.label}: ${formatCents(point.revenue)}, ${point.transactions} sales`}
                    title={`${point.label}\n${formatCents(point.revenue)} · ${point.transactions} sales`}
                  />
                </div>
                <span className="w-full truncate text-center text-xs text-muted-foreground transition-colors group-hover:text-foreground">
                  {point.label}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function CourseBreakdownTable({ rows }: { rows: CourseBreakdownRow[] }) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Course
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Instructor
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  List price
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Revenue
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Sales
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Enrollments
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Rating
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-10 text-center text-sm text-muted-foreground"
                  >
                    No courses found.
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr
                  key={row.courseId}
                  className="border-b border-border last:border-0"
                >
                  <td className="px-4 py-3 text-sm font-medium">{row.title}</td>
                  <td className="px-4 py-3 text-sm">{row.instructorName}</td>
                  <td className="px-4 py-3 text-right text-sm">
                    {formatCents(row.listPrice)}
                  </td>
                  <td className="px-4 py-3 text-right text-sm">
                    {formatCents(row.revenue)}
                  </td>
                  <td className="px-4 py-3 text-right text-sm">{row.sales}</td>
                  <td className="px-4 py-3 text-right text-sm">
                    {row.enrollments}
                  </td>
                  <td className="px-4 py-3 text-right text-sm">
                    {row.averageRating !== null
                      ? `${row.averageRating.toFixed(1)} (${row.ratingCount})`
                      : "—"}
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
  const {
    range,
    totalRevenue,
    totalEnrollments,
    topCourse,
    timeSeries,
    timeSeriesMonthly,
    instructors,
    selectedInstructorId,
    courseBreakdown,
  } = loaderData;
  const periodLabel = PRESET_LABELS[range.preset as RangePreset] ?? "Selected";
  const hasData = totalRevenue > 0 || totalEnrollments > 0;
  const navigate = useNavigate();

  function handleInstructorChange(value: string) {
    const params = new URLSearchParams(window.location.search);
    if (value === "all") {
      params.delete("instructorId");
    } else {
      params.set("instructorId", value);
    }
    navigate(`?${params.toString()}`, { preventScrollReset: true });
  }

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

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Platform Analytics</h1>
          <p className="mt-1 text-muted-foreground">
            Revenue and enrollments across every course and instructor
          </p>
        </div>
        <AnalyticsExport />
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
            <RevenueOverTimeTable points={timeSeriesMonthly} />
            <div className="mt-4">
              <RevenueOverTimeChart points={timeSeries} />
            </div>
          </div>

          <div className="mt-10">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">Courses</h2>
                <p className="text-sm text-muted-foreground">
                  {periodLabel} · revenue, sales, and enrollments per course
                </p>
              </div>
              <Select
                value={
                  selectedInstructorId ? String(selectedInstructorId) : "all"
                }
                onValueChange={handleInstructorChange}
              >
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="All instructors" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All instructors</SelectItem>
                  {instructors.map((instructor) => (
                    <SelectItem
                      key={instructor.id}
                      value={String(instructor.id)}
                    >
                      {instructor.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <CourseBreakdownTable rows={courseBreakdown} />
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
