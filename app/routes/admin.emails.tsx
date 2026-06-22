import { useEffect } from "react";
import { useFetcher, data, isRouteErrorResponse, Link } from "react-router";
import { toast } from "sonner";
import type { Route } from "./+types/admin.emails";
import { getCurrentUserId } from "~/lib/session";
import { getUserById } from "~/services/userService";
import {
  listOutbox,
  flushEmailOutbox,
  getEmailAdapter,
} from "~/services/emailService";
import { UserRole, EmailStatus } from "~/db/schema";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { AlertTriangle, Mail, Send } from "lucide-react";

export function meta() {
  return [
    { title: "Email Outbox — Cadence" },
    { name: "description", content: "Queued notification emails" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to view the outbox.", {
      status: 401,
    });
  }
  const currentUser = getUserById(currentUserId);
  if (!currentUser || currentUser.role !== UserRole.Admin) {
    throw data("Only admins can access this page.", { status: 403 });
  }

  return {
    outbox: listOutbox(100),
    adapterName: getEmailAdapter().name,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("You must be logged in.", { status: 401 });
  }
  const currentUser = getUserById(currentUserId);
  if (!currentUser || currentUser.role !== UserRole.Admin) {
    throw data("Only admins can send emails.", { status: 403 });
  }

  const formData = await request.formData();
  if (formData.get("intent") !== "flush") {
    throw data("Invalid action.", { status: 400 });
  }

  const result = await flushEmailOutbox();
  return {
    success: true,
    message: `Processed ${result.processed} — sent ${result.sent}, failed ${result.failed}.`,
  };
}

const STATUS_STYLES: Record<EmailStatus, string> = {
  [EmailStatus.Pending]:
    "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  [EmailStatus.Sent]:
    "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  [EmailStatus.Failed]: "bg-destructive/10 text-destructive",
};

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <Skeleton className="h-9 w-56" />
      <Skeleton className="mt-2 h-5 w-72" />
      <Skeleton className="mt-6 h-64 w-full rounded-xl" />
    </div>
  );
}

export default function AdminEmails({ loaderData }: Route.ComponentProps) {
  const { outbox, adapterName } = loaderData;
  const fetcher = useFetcher<{
    success?: boolean;
    message?: string;
    error?: string;
  }>();
  const flushing = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      toast.success(fetcher.data.message);
    }
  }, [fetcher.state, fetcher.data]);

  const pendingCount = outbox.filter(
    (e) => e.status !== EmailStatus.Sent
  ).length;

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Email Outbox</span>
      </nav>

      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Email Outbox</h1>
          <p className="mt-1 text-muted-foreground">
            Notification emails, sent via the{" "}
            <span className="font-medium">{adapterName}</span> adapter.
          </p>
        </div>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="flush" />
          <Button type="submit" disabled={flushing}>
            <Send className="mr-2 size-4" />
            {flushing ? "Sending…" : "Send pending"}
          </Button>
        </fetcher.Form>
      </div>

      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Mail className="size-4" />
        <span>
          {outbox.length} {outbox.length === 1 ? "email" : "emails"} ·{" "}
          {pendingCount} pending
        </span>
      </div>

      {outbox.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No emails queued yet.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3">To</th>
                    <th className="px-4 py-3">Subject</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Tries</th>
                    <th className="px-4 py-3">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {outbox.map((email) => (
                    <tr
                      key={email.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-4 py-3 text-sm">{email.toEmail}</td>
                      <td className="px-4 py-3 text-sm">
                        {email.subject}
                        {email.error && (
                          <span
                            className="block text-xs text-destructive"
                            title={email.error}
                          >
                            {email.error}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[email.status]}`}
                        >
                          {email.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {email.attempts}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {new Date(email.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading the outbox.";

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
        <Link to="/">
          <Button>Go Home</Button>
        </Link>
      </div>
    </div>
  );
}
