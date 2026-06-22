import { Link, useFetcher, redirect } from "react-router";
import { useEffect } from "react";
import { toast } from "sonner";
import * as v from "valibot";
import type { Route } from "./+types/courses.$slug.gift";
import {
  getCourseBySlug,
  getCourseWithDetails,
} from "~/services/courseService";
import { getCurrentUserId } from "~/lib/session";
import { CourseStatus } from "~/db/schema";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { ArrowLeft, Gift } from "lucide-react";
import { CourseImage } from "~/components/course-image";
import { UserAvatar } from "~/components/user-avatar";
import { data } from "react-router";
import { formatPrice } from "~/lib/utils";
import { resolveCountry } from "~/lib/country.server";
import { calculatePppPrice, getCountryTierInfo, COUNTRIES } from "~/lib/ppp";
import { buyGift } from "~/services/transactionService";
import { validatePromo, computeDiscountedPrice } from "~/services/promoService";
import { parseFormData, parseParams } from "~/lib/validation";

const giftParamsSchema = v.object({
  slug: v.pipe(v.string(), v.minLength(1)),
});

const giftActionSchema = v.object({
  intent: v.literal("confirm-gift"),
  recipientEmail: v.pipe(
    v.string(),
    v.trim(),
    v.email("Enter a valid email address.")
  ),
  message: v.optional(v.string()),
  promoCode: v.optional(v.string()),
});

export function meta({ data: loaderData }: Route.MetaArgs) {
  const title = loaderData?.course?.title ?? "Gift";
  return [
    { title: `Gift: ${title} — Cadence` },
    { name: "description", content: `Gift ${title} to someone` },
  ];
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const slug = params.slug;
  const course = getCourseBySlug(slug);
  if (!course || course.status !== CourseStatus.Published) {
    throw data("Course not found.", { status: 404 });
  }

  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw redirect(
      `/signup?redirectTo=${encodeURIComponent(`/courses/${slug}/gift`)}`
    );
  }
  // Instructors can't gift their own course.
  if (course.instructorId === currentUserId) {
    throw redirect(`/courses/${slug}`);
  }

  const courseWithDetails = getCourseWithDetails(course.id);
  if (!courseWithDetails) {
    throw data("Course not found.", { status: 404 });
  }

  const url = new URL(request.url);
  const country = await resolveCountry(request);
  const pppPrice = courseWithDetails.pppEnabled
    ? calculatePppPrice(courseWithDetails.price, country)
    : courseWithDetails.price;
  const tierInfo = getCountryTierInfo(country);
  const countryName = country
    ? (COUNTRIES.find((c) => c.code === country)?.name ?? country)
    : null;

  // Optional promo (?promo=) validated server-side; the action re-validates.
  const promoInput = url.searchParams.get("promo") ?? "";
  let appliedPromo: {
    code: string;
    discountType: string;
    discountValue: number;
  } | null = null;
  let promoError: string | null = null;
  let finalPrice = pppPrice;
  if (promoInput.trim()) {
    const result = validatePromo({ code: promoInput });
    if (result.ok) {
      appliedPromo = {
        code: result.promo.code,
        discountType: result.promo.discountType,
        discountValue: result.promo.discountValue,
      };
      finalPrice = computeDiscountedPrice(pppPrice, result.promo);
    } else {
      promoError = result.error;
    }
  }

  return {
    course: courseWithDetails,
    pppPrice,
    finalPrice,
    tierInfo,
    countryName,
    promoInput,
    appliedPromo,
    promoError,
  };
}

export async function action({ params, request }: Route.ActionArgs) {
  const { slug } = parseParams(params, giftParamsSchema);
  const course = getCourseBySlug(slug);
  if (!course) {
    throw data("Course not found.", { status: 404 });
  }

  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("You must be logged in.", { status: 401 });
  }

  const formData = await request.formData();
  const parsed = parseFormData(formData, giftActionSchema);
  if (!parsed.success) {
    return data(
      { error: Object.values(parsed.errors)[0] ?? "Invalid input." },
      { status: 400 }
    );
  }

  const country = await resolveCountry(request);
  const result = buyGift({
    userId: currentUserId,
    course,
    country,
    recipientEmail: parsed.data.recipientEmail,
    message: parsed.data.message?.trim() || null,
    promoCode: parsed.data.promoCode,
  });
  if (!result.ok) {
    return data({ error: result.error }, { status: 400 });
  }

  throw redirect("/gifts?sent=1");
}

export default function GiftCourse({ loaderData }: Route.ComponentProps) {
  const {
    course,
    pppPrice,
    finalPrice,
    tierInfo,
    countryName,
    promoInput,
    appliedPromo,
    promoError,
  } = loaderData;
  const fetcher = useFetcher<{ error?: string }>();
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(fetcher.data.error);
    }
  }, [fetcher.state, fetcher.data]);

  const isPppDiscounted = pppPrice < course.price;
  const isDiscounted = finalPrice < course.price;
  const appliedCode = appliedPromo?.code ?? "";

  return (
    <div className="mx-auto max-w-3xl p-6 lg:p-8">
      <Link
        to={`/courses/${course.slug}`}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to course
      </Link>

      <h1 className="mb-2 flex items-center gap-2 text-2xl font-bold">
        <Gift className="size-6 text-primary" />
        Gift this course
      </h1>
      <p className="mb-8 text-muted-foreground">
        Buy this course for someone else. They&apos;ll get a link to claim it.
      </p>

      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col gap-6 sm:flex-row">
            <div className="w-full shrink-0 overflow-hidden rounded-lg sm:w-48">
              <CourseImage
                src={course.coverImageUrl}
                alt={course.title}
                className="aspect-video h-full w-full object-cover sm:aspect-auto"
              />
            </div>
            <div className="flex-1">
              <h2 className="mb-1 text-xl font-semibold">{course.title}</h2>
              <p className="mb-4 text-sm text-muted-foreground">
                {course.description}
              </p>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <UserAvatar
                  name={course.instructorName}
                  avatarUrl={course.instructorAvatarUrl}
                  className="size-6"
                />
                <span>Taught by {course.instructorName}</span>
              </div>
            </div>
          </div>

          <div className="mt-6 border-t pt-6">
            {isPppDiscounted && countryName && (
              <div className="mb-4 rounded-lg bg-green-50 p-3 dark:bg-green-900/20">
                <p className="text-sm text-green-800 dark:text-green-300">
                  PPP discount applied for {countryName} — {tierInfo.label}
                </p>
              </div>
            )}

            {/* Promo code (GET form sets ?promo=, loader validates). */}
            <form method="get" className="mb-6">
              <label className="mb-1.5 block text-sm font-medium">
                Promo code
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  name="promo"
                  defaultValue={promoInput}
                  placeholder="Enter a code"
                  className="flex-1 rounded-md border bg-background px-3 py-2 text-sm uppercase placeholder:normal-case focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <Button type="submit" variant="outline">
                  Apply
                </Button>
              </div>
              {appliedPromo && (
                <p className="mt-2 text-sm text-green-700 dark:text-green-400">
                  Code{" "}
                  <span className="font-semibold">{appliedPromo.code}</span>{" "}
                  applied —{" "}
                  {appliedPromo.discountType === "percent"
                    ? `${appliedPromo.discountValue}% off`
                    : `${formatPrice(appliedPromo.discountValue)} off`}
                  .
                </p>
              )}
              {promoError && (
                <p className="mt-2 text-sm text-destructive">{promoError}</p>
              )}
            </form>

            <fetcher.Form method="post" className="space-y-4">
              <input type="hidden" name="intent" value="confirm-gift" />
              <input type="hidden" name="promoCode" value={appliedCode} />
              <div className="space-y-1.5">
                <Label htmlFor="recipientEmail">Recipient email</Label>
                <Input
                  id="recipientEmail"
                  name="recipientEmail"
                  type="email"
                  placeholder="friend@example.com"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="message">Message (optional)</Label>
                <textarea
                  id="message"
                  name="message"
                  rows={3}
                  placeholder="Happy learning!"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              <div className="flex items-center justify-between border-t pt-4">
                <div>
                  {isDiscounted ? (
                    <>
                      <div className="text-sm text-muted-foreground line-through">
                        {formatPrice(course.price)}
                      </div>
                      <div className="text-3xl font-bold">
                        {formatPrice(finalPrice)}
                      </div>
                    </>
                  ) : (
                    <div className="text-3xl font-bold">
                      {formatPrice(finalPrice)}
                    </div>
                  )}
                </div>
                <Button size="lg" disabled={isSubmitting}>
                  {isSubmitting ? "Processing..." : "Buy Gift"}
                </Button>
              </div>
            </fetcher.Form>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
