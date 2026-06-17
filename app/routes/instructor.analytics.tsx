import { Link, data, isRouteErrorResponse } from "react-router";
import type { Route } from "./+types/instructor.analytics";
import { getCurrentUserId } from "~/lib/session";
import { getUserById } from "~/services/userService";
import { getCoursesByInstructor, getAllCourses } from "~/services/courseService";
import {
  getRevenueSummary,
  getOutstandingSeats,
} from "~/services/analyticsService";
import { UserRole } from "~/db/schema";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Skeleton } from "~/components/ui/skeleton";
import {
  AlertTriangle,
  DollarSign,
  Receipt,
  Ticket,
  Hourglass,
  type LucideIcon,
} from "lucide-react";
import { formatCents } from "~/lib/utils";
import {
  resolveRange,
  PRESET_LABELS,
  type RangePreset,
} from "~/lib/analytics";

export function meta() {
  return [
    { title: "Analytics — Cadence" },
    { name: "description", content: "Revenue analytics for your courses" },
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

  if (
    !user ||
    (user.role !== UserRole.Instructor && user.role !== UserRole.Admin)
  ) {
    throw data("Only instructors and admins can access analytics.", {
      status: 403,
    });
  }

  // The route decides scope; the service is auth-agnostic.
  const isAdmin = user.role === UserRole.Admin;
  const courseIds = (
    isAdmin ? getAllCourses() : getCoursesByInstructor(currentUserId)
  ).map((course) => course.id);

  const range = resolveRange(new URL(request.url).searchParams);
  const period = getRevenueSummary({
    courseIds,
    from: range.from,
    to: range.to,
  });
  const allTime = getRevenueSummary({ courseIds });

  return {
    scope: isAdmin ? ("platform" as const) : ("instructor" as const),
    range: {
      preset: range.preset,
      fromDate: range.fromDate,
      toDate: range.toDate,
    },
    periodRevenue: period.totalRevenue,
    allTimeRevenue: allTime.totalRevenue,
    salesCount: period.transactionCount,
    averageOrderValue: period.averageOrderValue,
    seatsSold: period.seatsSold,
    // Outstanding seats are a snapshot of all unredeemed seats, not period-scoped.
    outstandingSeats: getOutstandingSeats({ courseIds }),
  };
}

const PRESETS: RangePreset[] = ["7d", "30d", "90d", "all"];

function Kpi({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
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
        <div className="text-3xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <Skeleton className="h-9 w-40" />
      <Skeleton className="mt-2 h-5 w-72" />
      <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-32 w-full" />
      </div>
    </div>
  );
}

export default function InstructorAnalytics({
  loaderData,
}: Route.ComponentProps) {
  const {
    scope,
    range,
    periodRevenue,
    allTimeRevenue,
    salesCount,
    averageOrderValue,
    seatsSold,
    outstandingSeats,
  } = loaderData;
  const periodLabel =
    range.preset === "custom"
      ? "Selected range"
      : PRESET_LABELS[range.preset];

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Analytics</span>
      </nav>

      <div className="mb-6">
        <h1 className="text-3xl font-bold">Analytics</h1>
        <p className="mt-1 text-muted-foreground">
          {scope === "platform"
            ? "Platform-wide revenue across all courses"
            : "Revenue across all your courses"}
        </p>
      </div>

      {/* Date range controls */}
      <div className="mb-8 flex flex-wrap items-end gap-4">
        <div className="flex flex-wrap gap-2">
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

        <form method="get" className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            From
            <Input
              type="date"
              name="from"
              defaultValue={range.fromDate ?? ""}
              className="w-40"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            To
            <Input
              type="date"
              name="to"
              defaultValue={range.toDate ?? ""}
              className="w-40"
            />
          </label>
          <Button
            type="submit"
            size="sm"
            variant={range.preset === "custom" ? "default" : "outline"}
          >
            Apply
          </Button>
        </form>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <Kpi
          label={`Revenue · ${periodLabel}`}
          value={formatCents(periodRevenue)}
          icon={DollarSign}
        />
        <Kpi
          label="Revenue · all time"
          value={formatCents(allTimeRevenue)}
          icon={DollarSign}
        />
        <Kpi
          label={`Sales · ${periodLabel}`}
          value={String(salesCount)}
          icon={Receipt}
        />
        <Kpi
          label={`Avg order value · ${periodLabel}`}
          value={formatCents(averageOrderValue)}
          icon={DollarSign}
        />
        <Kpi
          label={`Seats sold · ${periodLabel}`}
          value={String(seatsSold)}
          icon={Ticket}
        />
        <Kpi
          label="Outstanding seats"
          value={String(outstandingSeats)}
          icon={Hourglass}
        />
      </div>
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
          : "You don't have permission to access this page.";
    } else {
      title = `Error ${error.status}`;
      message =
        typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <div className="flex items-center justify-center gap-3">
          <Link to="/courses">
            <Button variant="outline">Browse Courses</Button>
          </Link>
          <Link to="/">
            <Button>Go Home</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
