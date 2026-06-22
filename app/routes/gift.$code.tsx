import { Link, useFetcher, redirect } from "react-router";
import { useEffect } from "react";
import { toast } from "sonner";
import * as v from "valibot";
import type { Route } from "./+types/gift.$code";
import { getCourseById } from "~/services/courseService";
import { getGiftByCode } from "~/services/giftService";
import { claimGift } from "~/services/transactionService";
import { isUserEnrolled } from "~/services/enrollmentService";
import { getCurrentUserId } from "~/lib/session";
import { parseParams, parseFormData } from "~/lib/validation";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Gift, AlertCircle, CheckCircle2 } from "lucide-react";
import { data } from "react-router";

const giftParamsSchema = v.object({
  code: v.pipe(v.string(), v.minLength(1)),
});

const giftActionSchema = v.object({
  intent: v.literal("confirm-claim"),
});

export function meta({ data: loaderData }: Route.MetaArgs) {
  const title = loaderData?.course?.title ?? "Claim Gift";
  return [
    { title: `Claim Gift: ${title} — Cadence` },
    { name: "description", content: `Claim your gift of ${title}` },
  ];
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const { code } = parseParams(params, giftParamsSchema);

  const gift = getGiftByCode(code);
  if (!gift) {
    throw data("Gift not found.", { status: 404 });
  }

  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw redirect(`/login?redirectTo=${encodeURIComponent(`/gift/${code}`)}`);
  }

  const course = getCourseById(gift.courseId);
  if (!course) {
    throw data("Course not found.", { status: 404 });
  }

  return {
    course: { id: course.id, title: course.title, slug: course.slug },
    code,
    recipientEmail: gift.recipientEmail,
    message: gift.message,
    alreadyClaimed: gift.claimedAt !== null,
    alreadyEnrolled: isUserEnrolled({
      userId: currentUserId,
      courseId: gift.courseId,
    }),
  };
}

export async function action({ params, request }: Route.ActionArgs) {
  const { code } = parseParams(params, giftParamsSchema);

  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("You must be logged in.", { status: 401 });
  }

  const formData = await request.formData();
  const parsed = parseFormData(formData, giftActionSchema);
  if (!parsed.success) {
    throw data("Invalid action.", { status: 400 });
  }

  const result = claimGift({ code, userId: currentUserId });
  if (!result.ok) {
    return data({ error: result.error }, { status: 400 });
  }

  const course = getCourseById(result.data.courseId);
  if (!course) {
    throw redirect("/courses");
  }
  throw redirect(`/courses/${course.slug}/welcome`);
}

export default function ClaimGift({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { course, recipientEmail, message, alreadyClaimed, alreadyEnrolled } =
    loaderData;
  const fetcher = useFetcher();
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    const error =
      fetcher.data?.error ?? (actionData as { error?: string })?.error;
    if (error) {
      toast.error(error);
    }
  }, [fetcher.data, actionData]);

  const canClaim = !alreadyClaimed && !alreadyEnrolled;

  return (
    <div className="mx-auto max-w-2xl p-6 lg:p-8">
      <h1 className="mb-2 text-2xl font-bold">You&apos;ve received a gift!</h1>
      <p className="mb-8 text-muted-foreground">
        Someone gifted you a course on Cadence.
      </p>

      <Card>
        <CardContent className="p-8 text-center">
          <div className="mb-4 inline-flex size-16 items-center justify-center rounded-full bg-primary/10">
            <Gift className="size-8 text-primary" />
          </div>

          <h2 className="mb-2 text-xl font-semibold">{course.title}</h2>
          <p className="mb-2 text-sm text-muted-foreground">
            Intended for{" "}
            <span className="font-medium text-foreground">
              {recipientEmail}
            </span>
          </p>
          {message && (
            <blockquote className="mx-auto mb-6 max-w-md rounded-lg bg-muted p-4 text-sm italic text-muted-foreground">
              &ldquo;{message}&rdquo;
            </blockquote>
          )}

          {alreadyClaimed ? (
            <div className="rounded-lg bg-destructive/10 p-4">
              <div className="flex items-center justify-center gap-2 text-destructive">
                <AlertCircle className="size-5" />
                <span className="font-medium">
                  This gift has already been claimed
                </span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                The course access has already been claimed with this link.
              </p>
            </div>
          ) : alreadyEnrolled ? (
            <div className="rounded-lg bg-green-50 p-4 dark:bg-green-900/20">
              <div className="flex items-center justify-center gap-2 text-green-700 dark:text-green-400">
                <CheckCircle2 className="size-5" />
                <span className="font-medium">
                  You&apos;re already enrolled
                </span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                You already have access to this course.
              </p>
              <Link to={`/courses/${course.slug}`}>
                <Button className="mt-4" size="lg">
                  Go to Course
                </Button>
              </Link>
            </div>
          ) : (
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="confirm-claim" />
              <Button
                size="lg"
                className="w-full max-w-sm"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Claiming..." : "Claim Your Gift"}
              </Button>
            </fetcher.Form>
          )}

          {!canClaim && (
            <div className="mt-6">
              <Link
                to={`/courses/${course.slug}`}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                View course details
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
