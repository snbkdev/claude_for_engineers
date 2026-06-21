import { useEffect, useRef, useState } from "react";
import { useFetcher, data, isRouteErrorResponse, Link } from "react-router";
import { toast } from "sonner";
import * as v from "valibot";
import type { Route } from "./+types/admin.promos";
import { getCurrentUserId } from "~/lib/session";
import { getUserById } from "~/services/userService";
import {
  listPromos,
  createPromo,
  setPromoActive,
  deletePromo,
} from "~/services/promoService";
import { parseFormData } from "~/lib/validation";
import { UserRole, PromoDiscountType } from "~/db/schema";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Skeleton } from "~/components/ui/skeleton";
import { formatPrice } from "~/lib/utils";
import { AlertTriangle, Tag, Trash2 } from "lucide-react";

const adminPromoActionSchema = v.variant("intent", [
  v.object({
    intent: v.literal("create"),
    code: v.pipe(v.string(), v.trim(), v.minLength(1, "Code is required.")),
    discountType: v.enum(PromoDiscountType),
    discountValue: v.pipe(
      v.string(),
      v.transform(Number),
      v.integer(),
      v.minValue(1)
    ),
    maxRedemptions: v.optional(v.string()),
    expiresAt: v.optional(v.string()),
  }),
  v.object({
    intent: v.literal("toggle-active"),
    promoId: v.pipe(v.string(), v.transform(Number), v.integer()),
    active: v.picklist(["true", "false"]),
  }),
  v.object({
    intent: v.literal("delete"),
    promoId: v.pipe(v.string(), v.transform(Number), v.integer()),
  }),
]);

export function meta() {
  return [
    { title: "Manage Promo Codes — Cadence" },
    { name: "description", content: "Create and manage marketing promo codes" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to manage promo codes.", {
      status: 401,
    });
  }
  const currentUser = getUserById(currentUserId);
  if (!currentUser || currentUser.role !== UserRole.Admin) {
    throw data("Only admins can access this page.", { status: 403 });
  }

  return { promos: listPromos() };
}

export async function action({ request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("You must be logged in.", { status: 401 });
  }
  const currentUser = getUserById(currentUserId);
  if (!currentUser || currentUser.role !== UserRole.Admin) {
    throw data("Only admins can manage promo codes.", { status: 403 });
  }

  const formData = await request.formData();
  const parsed = parseFormData(formData, adminPromoActionSchema);
  if (!parsed.success) {
    return data(
      { error: Object.values(parsed.errors)[0] ?? "Invalid input." },
      { status: 400 }
    );
  }

  const { intent } = parsed.data;

  if (intent === "create") {
    const maxRaw = parsed.data.maxRedemptions?.trim();
    const maxRedemptions = maxRaw ? Number(maxRaw) : null;
    if (
      maxRedemptions !== null &&
      (!Number.isInteger(maxRedemptions) || maxRedemptions < 1)
    ) {
      return data(
        { error: "Usage limit must be a positive whole number." },
        { status: 400 }
      );
    }
    const expiresRaw = parsed.data.expiresAt?.trim();
    const expiresAt = expiresRaw
      ? new Date(`${expiresRaw}T23:59:59.999Z`).toISOString()
      : null;

    const result = createPromo({
      code: parsed.data.code,
      discountType: parsed.data.discountType,
      discountValue: parsed.data.discountValue,
      maxRedemptions,
      expiresAt,
    });
    if (!result.ok) {
      return data({ error: result.error }, { status: 400 });
    }
    return { success: true, message: `Promo ${result.promo.code} created.` };
  }

  if (intent === "toggle-active") {
    setPromoActive({
      id: parsed.data.promoId,
      active: parsed.data.active === "true",
    });
    return { success: true, message: "Promo updated." };
  }

  if (intent === "delete") {
    deletePromo(parsed.data.promoId);
    return { success: true, message: "Promo deleted." };
  }

  throw data("Invalid action.", { status: 400 });
}

function CreatePromoForm() {
  const fetcher = useFetcher<{
    success?: boolean;
    message?: string;
    error?: string;
  }>();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      toast.success(fetcher.data.message);
      formRef.current?.reset();
    }
    if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(fetcher.data.error);
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <Card className="mb-6">
      <CardHeader>
        <h2 className="text-lg font-semibold">New promo code</h2>
      </CardHeader>
      <CardContent>
        <fetcher.Form
          ref={formRef}
          method="post"
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5"
        >
          <input type="hidden" name="intent" value="create" />
          <div className="space-y-1.5">
            <Label htmlFor="code">Code</Label>
            <Input id="code" name="code" placeholder="SUMMER25" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="discountType">Type</Label>
            <select
              id="discountType"
              name="discountType"
              defaultValue={PromoDiscountType.Percent}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value={PromoDiscountType.Percent}>Percent (%)</option>
              <option value={PromoDiscountType.Fixed}>Fixed ($ off)</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="discountValue">Value</Label>
            <Input
              id="discountValue"
              name="discountValue"
              type="number"
              min={1}
              placeholder="25"
              required
            />
            <p className="text-xs text-muted-foreground">% or cents off</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="maxRedemptions">Usage limit</Label>
            <Input
              id="maxRedemptions"
              name="maxRedemptions"
              type="number"
              min={1}
              placeholder="∞"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="expiresAt">Expires</Label>
            <Input id="expiresAt" name="expiresAt" type="date" />
          </div>
          <div className="sm:col-span-2 lg:col-span-5">
            <Button type="submit" disabled={fetcher.state !== "idle"}>
              Create promo
            </Button>
          </div>
        </fetcher.Form>
      </CardContent>
    </Card>
  );
}

type Promo = Route.ComponentProps["loaderData"]["promos"][number];

function formatDiscount(promo: Promo): string {
  return promo.discountType === PromoDiscountType.Percent
    ? `${promo.discountValue}%`
    : `${formatPrice(promo.discountValue)}`;
}

function PromoRow({ promo }: { promo: Promo }) {
  const toggleFetcher = useFetcher();
  const deleteFetcher = useFetcher();
  const isExpired =
    promo.expiresAt !== null &&
    new Date(promo.expiresAt).getTime() < Date.now();

  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-3 font-mono text-sm font-medium">{promo.code}</td>
      <td className="px-4 py-3 text-sm">{formatDiscount(promo)}</td>
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {promo.redemptionCount}
        {promo.maxRedemptions !== null ? ` / ${promo.maxRedemptions}` : ""}
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {promo.expiresAt ? (
          <span className={isExpired ? "text-destructive" : undefined}>
            {new Date(promo.expiresAt).toLocaleDateString()}
            {isExpired ? " (expired)" : ""}
          </span>
        ) : (
          "—"
        )}
      </td>
      <td className="px-4 py-3">
        <toggleFetcher.Form method="post">
          <input type="hidden" name="intent" value="toggle-active" />
          <input type="hidden" name="promoId" value={promo.id} />
          <input
            type="hidden"
            name="active"
            value={promo.active ? "false" : "true"}
          />
          <button
            type="submit"
            className={
              promo.active
                ? "rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-950 dark:text-green-300"
                : "rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
            }
            title="Toggle active"
          >
            {promo.active ? "Active" : "Inactive"}
          </button>
        </toggleFetcher.Form>
      </td>
      <td className="px-4 py-3">
        <deleteFetcher.Form method="post">
          <input type="hidden" name="intent" value="delete" />
          <input type="hidden" name="promoId" value={promo.id} />
          <button
            type="submit"
            className="text-muted-foreground transition-colors hover:text-destructive"
            title="Delete promo"
            disabled={deleteFetcher.state !== "idle"}
          >
            <Trash2 className="size-4" />
          </button>
        </deleteFetcher.Form>
      </td>
    </tr>
  );
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <Skeleton className="h-9 w-56" />
      <Skeleton className="mt-2 h-5 w-72" />
      <Skeleton className="mt-6 h-40 w-full rounded-xl" />
      <Skeleton className="mt-6 h-64 w-full rounded-xl" />
    </div>
  );
}

export default function AdminPromos({ loaderData }: Route.ComponentProps) {
  const { promos } = loaderData;

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Manage Promo Codes</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Promo Codes</h1>
        <p className="mt-1 text-muted-foreground">
          Global checkout discounts, separate from team seat coupons.
        </p>
      </div>

      <CreatePromoForm />

      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Tag className="size-4" />
        <span>
          {promos.length} {promos.length === 1 ? "code" : "codes"}
        </span>
      </div>

      {promos.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No promo codes yet. Create one above.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3">Code</th>
                    <th className="px-4 py-3">Discount</th>
                    <th className="px-4 py-3">Used</th>
                    <th className="px-4 py-3">Expires</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {promos.map((promo) => (
                    <PromoRow key={promo.id} promo={promo} />
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
  let message = "An unexpected error occurred while loading promo management.";

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
