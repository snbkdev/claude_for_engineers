import { useEffect } from "react";
import { Link, useFetcher, data, isRouteErrorResponse } from "react-router";
import { toast } from "sonner";
import type { Route } from "./+types/leaderboard";
import { getCurrentUserId } from "~/lib/session";
import { getUserById, setLeaderboardOptOut } from "~/services/userService";
import {
  getLeaderboard,
  type LeaderboardPeriod,
} from "~/services/leaderboardService";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { UserAvatar } from "~/components/user-avatar";
import { cn } from "~/lib/utils";
import {
  AlertTriangle,
  Eye,
  EyeOff,
  Medal,
  Sparkles,
  Trophy,
} from "lucide-react";

const TOP_N = 50;

export function meta() {
  return [
    { title: "Leaderboard — Cadence" },
    { name: "description", content: "Top learners ranked by XP" },
  ];
}

function parsePeriod(value: string | null): LeaderboardPeriod {
  return value === "weekly" ? "weekly" : "all-time";
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to view the leaderboard.", {
      status: 401,
    });
  }

  const url = new URL(request.url);
  const period = parsePeriod(url.searchParams.get("period"));

  const user = getUserById(currentUserId);
  const optedOut = user?.leaderboardOptOut ?? false;

  const entries = getLeaderboard({ period, currentUserId });
  const top = entries.slice(0, TOP_N);

  // The current user's own row (null when opted out — they're not ranked).
  const selfEntry = entries.find((e) => e.isCurrentUser) ?? null;
  const selfInTop = selfEntry ? selfEntry.rank <= TOP_N : false;

  return {
    period,
    top,
    totalRanked: entries.length,
    selfEntry,
    selfInTop,
    optedOut,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("You must be logged in", { status: 401 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "toggle-privacy") {
    const user = getUserById(currentUserId);
    if (!user) {
      throw data("User not found", { status: 404 });
    }
    setLeaderboardOptOut({
      userId: currentUserId,
      optOut: !user.leaderboardOptOut,
    });
    return { success: true, optedOut: !user.leaderboardOptOut };
  }

  throw data("Invalid action", { status: 400 });
}

const PERIODS: Array<{ value: LeaderboardPeriod; label: string }> = [
  { value: "all-time", label: "All time" },
  { value: "weekly", label: "This week" },
];

function rankAccent(rank: number): string {
  if (rank === 1) return "text-amber-500";
  if (rank === 2) return "text-slate-400";
  if (rank === 3) return "text-orange-600";
  return "text-muted-foreground";
}

type Entry = Route.ComponentProps["loaderData"]["top"][number];

function LeaderboardRow({ entry }: { entry: Entry }) {
  return (
    <div
      className={cn(
        "flex items-center gap-4 rounded-lg border p-3",
        entry.isCurrentUser
          ? "border-primary/40 bg-primary/5"
          : "border-transparent"
      )}
    >
      <div className="flex w-10 shrink-0 items-center justify-center">
        {entry.rank <= 3 ? (
          <Medal className={cn("size-6", rankAccent(entry.rank))} />
        ) : (
          <span className="text-sm font-semibold text-muted-foreground">
            {entry.rank}
          </span>
        )}
      </div>
      <UserAvatar
        name={entry.name}
        avatarUrl={entry.avatarUrl}
        className="size-9"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">
          {entry.name}
          {entry.isCurrentUser && (
            <span className="ml-2 text-xs text-primary">You</span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">Level {entry.level}</p>
      </div>
      <div className="flex items-center gap-1.5 font-semibold">
        <Sparkles className="size-4 text-violet-500" />
        {entry.xp}
        <span className="text-xs font-normal text-muted-foreground">XP</span>
      </div>
    </div>
  );
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-3xl p-6 lg:p-8">
      <Skeleton className="h-9 w-40" />
      <Skeleton className="mt-2 h-5 w-64" />
      <Skeleton className="mt-8 h-96 w-full rounded-xl" />
    </div>
  );
}

export default function LeaderboardPage({ loaderData }: Route.ComponentProps) {
  const { period, top, selfEntry, selfInTop, optedOut } = loaderData;
  const privacyFetcher = useFetcher();

  useEffect(() => {
    const result = privacyFetcher.data as
      | { success?: boolean; optedOut?: boolean }
      | undefined;
    if (privacyFetcher.state === "idle" && result?.success) {
      toast.success(
        result.optedOut
          ? "You're now hidden from the leaderboard."
          : "You're back on the leaderboard."
      );
    }
  }, [privacyFetcher.state, privacyFetcher.data]);

  return (
    <div className="mx-auto max-w-3xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/dashboard" className="hover:text-foreground">
          Dashboard
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Leaderboard</span>
      </nav>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Trophy className="size-7 text-amber-500" />
          <h1 className="text-3xl font-bold">Leaderboard</h1>
        </div>
        <privacyFetcher.Form method="post">
          <input type="hidden" name="intent" value="toggle-privacy" />
          <Button type="submit" variant="outline" size="sm">
            {optedOut ? (
              <>
                <Eye className="mr-2 size-4" />
                Show me
              </>
            ) : (
              <>
                <EyeOff className="mr-2 size-4" />
                Hide me
              </>
            )}
          </Button>
        </privacyFetcher.Form>
      </div>

      {/* Period toggle */}
      <div className="mb-6 inline-flex rounded-lg border p-1">
        {PERIODS.map((p) => (
          <Link
            key={p.value}
            to={`/leaderboard?period=${p.value}`}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
              period === p.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {p.label}
          </Link>
        ))}
      </div>

      {optedOut && (
        <Card className="mb-6 border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40">
          <CardContent className="flex items-center gap-3 p-4 text-sm">
            <EyeOff className="size-5 shrink-0 text-amber-600" />
            <p className="text-amber-800 dark:text-amber-300">
              You're hidden from the leaderboard, so your rank isn't shown. Use
              "Show me" to rejoin.
            </p>
          </CardContent>
        </Card>
      )}

      {top.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Trophy className="mb-4 size-12 text-muted-foreground/50" />
          <h2 className="text-lg font-medium">No rankings yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Complete lessons to earn XP and climb the leaderboard.
          </p>
        </div>
      ) : (
        <Card>
          <CardContent className="space-y-2 p-3">
            {top.map((entry) => (
              <LeaderboardRow key={entry.userId} entry={entry} />
            ))}
          </CardContent>
        </Card>
      )}

      {/* The current user's own position when they're ranked below the top N. */}
      {selfEntry && !selfInTop && (
        <>
          <p className="mt-6 mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Your position
          </p>
          <Card>
            <CardContent className="p-3">
              <LeaderboardRow entry={selfEntry} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading the leaderboard.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
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
        <p className="text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
