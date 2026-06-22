import {
  Link,
  isRouteErrorResponse,
  data,
  useSearchParams,
} from "react-router";
import { useEffect } from "react";
import { toast } from "sonner";
import type { Route } from "./+types/gifts";
import { getCurrentUserId } from "~/lib/session";
import { getGiftsBySender } from "~/services/giftService";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { CopyLinkButton } from "~/components/copy-link-button";
import { AlertTriangle, Gift, CheckCircle2, Clock } from "lucide-react";

export function meta() {
  return [
    { title: "Gifts — Cadence" },
    { name: "description", content: "Course gifts you've sent" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to view your gifts.", {
      status: 401,
    });
  }

  const origin = new URL(request.url).origin;
  const gifts = getGiftsBySender(currentUserId).map((g) => ({
    ...g,
    claimUrl: `${origin}/gift/${g.code}`,
  }));

  return { gifts };
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-8">
      <Skeleton className="h-9 w-48" />
      <Skeleton className="mt-2 h-5 w-64" />
      <Skeleton className="mt-8 h-40 w-full rounded-xl" />
    </div>
  );
}

export default function Gifts({ loaderData }: Route.ComponentProps) {
  const { gifts } = loaderData;
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    if (searchParams.get("sent") === "1") {
      toast.success("Gift purchased! Share the claim link below.");
      const next = new URLSearchParams(searchParams);
      next.delete("sent");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Gifts</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Gifts You&apos;ve Sent</h1>
        <p className="mt-1 text-muted-foreground">
          Share each claim link with its recipient.
        </p>
      </div>

      {gifts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Gift className="mb-4 size-12 text-muted-foreground/50" />
          <h2 className="text-lg font-medium">No gifts yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Gift a course from any course page to send access to someone.
          </p>
          <Link to="/courses" className="mt-4">
            <Button>Browse Courses</Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {gifts.map((gift) => (
            <Card key={gift.id}>
              <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <Link
                    to={`/courses/${gift.courseSlug}`}
                    className="font-semibold hover:text-primary"
                  >
                    {gift.courseTitle}
                  </Link>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    For {gift.recipientEmail}
                  </p>
                  {gift.claimedAt ? (
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
                      <CheckCircle2 className="size-4" />
                      Claimed
                      {gift.claimedByName ? ` by ${gift.claimedByName}` : ""}
                    </p>
                  ) : (
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400">
                      <Clock className="size-4" />
                      Not claimed yet
                    </p>
                  )}
                </div>
                {!gift.claimedAt && (
                  <div className="shrink-0">
                    <CopyLinkButton url={gift.claimUrl} />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading your gifts.";

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
        <p className="mb-6 text-muted-foreground">{message}</p>
        <Link to="/courses">
          <Button>Browse Courses</Button>
        </Link>
      </div>
    </div>
  );
}
