import { useEffect } from "react";
import { useFetcher, data, isRouteErrorResponse, Link } from "react-router";
import { toast } from "sonner";
import type { Route } from "./+types/admin.purchases";
import { getCurrentUserId } from "~/lib/session";
import { getUserById } from "~/services/userService";
import { getAllPurchasesWithDetails } from "~/services/purchaseService";
import { refund } from "~/services/transactionService";
import { UserRole } from "~/db/schema";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { formatPrice } from "~/lib/utils";
import { AlertTriangle, Receipt, RotateCcw } from "lucide-react";

export function meta() {
  return [
    { title: "Purchases & Refunds — Cadence" },
    { name: "description", content: "All platform purchases and refunds" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to view purchases.", {
      status: 401,
    });
  }
  const currentUser = getUserById(currentUserId);
  if (!currentUser || currentUser.role !== UserRole.Admin) {
    throw data("Only admins can access this page.", { status: 403 });
  }

  return { purchases: getAllPurchasesWithDetails() };
}

export async function action({ request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("You must be logged in.", { status: 401 });
  }
  const currentUser = getUserById(currentUserId);
  if (!currentUser || currentUser.role !== UserRole.Admin) {
    throw data("Only admins can issue refunds.", { status: 403 });
  }

  const formData = await request.formData();
  if (formData.get("intent") !== "refund") {
    throw data("Invalid action.", { status: 400 });
  }
  const purchaseId = Number(formData.get("purchaseId"));
  if (Number.isNaN(purchaseId)) {
    throw data("Invalid purchase.", { status: 400 });
  }

  // Admin override: no window restriction.
  const result = refund({
    purchaseId,
    requestedByUserId: currentUserId,
    isAdmin: true,
  });
  if (!result.ok) {
    return data({ error: result.error }, { status: 400 });
  }
  return {
    success: true,
    message: result.data.team
      ? `Refunded — ${result.data.couponsRevoked} seat(s) revoked.`
      : "Purchase refunded.",
  };
}

type PurchaseRow = Route.ComponentProps["loaderData"]["purchases"][number];

function RefundCell({ purchase }: { purchase: PurchaseRow }) {
  const fetcher = useFetcher<{
    error?: string;
    success?: boolean;
    message?: string;
  }>();
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      if (fetcher.data.error) toast.error(fetcher.data.error);
      else if (fetcher.data.success)
        toast.success(fetcher.data.message ?? "Refunded.");
    }
  }, [fetcher.state, fetcher.data]);

  if (purchase.refundedAt) {
    return (
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        Refunded {new Date(purchase.refundedAt).toLocaleDateString()}
      </span>
    );
  }

  return (
    <fetcher.Form
      method="post"
      onSubmit={(e) => {
        if (
          !confirm(
            `Refund ${purchase.userName}'s purchase of "${purchase.courseTitle}"? Access will be revoked.`
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="intent" value="refund" />
      <input type="hidden" name="purchaseId" value={purchase.id} />
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        disabled={busy}
        className="text-muted-foreground hover:text-destructive"
      >
        <RotateCcw className="mr-2 size-4" />
        {busy ? "Refunding…" : "Refund"}
      </Button>
    </fetcher.Form>
  );
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <Skeleton className="h-9 w-56" />
      <Skeleton className="mt-2 h-5 w-72" />
      <Skeleton className="mt-6 h-64 w-full rounded-xl" />
    </div>
  );
}

export default function AdminPurchases({ loaderData }: Route.ComponentProps) {
  const { purchases } = loaderData;

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Purchases &amp; Refunds</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Purchases &amp; Refunds</h1>
        <p className="mt-1 text-muted-foreground">
          Every platform purchase. Admins can refund any purchase at any time.
        </p>
      </div>

      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Receipt className="size-4" />
        <span>
          {purchases.length} {purchases.length === 1 ? "purchase" : "purchases"}
        </span>
      </div>

      {purchases.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No purchases yet.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Student</th>
                    <th className="px-4 py-3">Course</th>
                    <th className="px-4 py-3">Paid</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {purchases.map((p) => (
                    <tr
                      key={p.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {new Date(p.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium">
                        {p.userName}
                      </td>
                      <td className="px-4 py-3 text-sm">{p.courseTitle}</td>
                      <td className="px-4 py-3 text-sm">
                        {formatPrice(p.pricePaid)}
                      </td>
                      <td className="px-4 py-3">
                        <RefundCell purchase={p} />
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
  let message = "An unexpected error occurred while loading purchases.";

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
