import { Link, isRouteErrorResponse, data } from "react-router";
import type { Route } from "./+types/wishlist";
import { getCurrentUserId } from "~/lib/session";
import { getWishlist } from "~/services/wishlistService";
import { getUserEnrolledCourses } from "~/services/enrollmentService";
import { resolveCountry } from "~/lib/country.server";
import { calculatePppPrice } from "~/lib/ppp";
import { CourseStatus } from "~/db/schema";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { CourseImage } from "~/components/course-image";
import { WishlistButton } from "~/components/wishlist-button";
import { formatPrice } from "~/lib/utils";
import { AlertTriangle, Heart, ShoppingCart } from "lucide-react";

export function meta() {
  return [
    { title: "Wishlist — Cadence" },
    { name: "description", content: "Courses you saved for later" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to view your wishlist.", {
      status: 401,
    });
  }

  const country = await resolveCountry(request);
  const enrolledIds = new Set(
    getUserEnrolledCourses(currentUserId).map((e) => e.courseId)
  );

  // Drop already-owned and unpublished courses; apply PPP pricing.
  const items = getWishlist(currentUserId)
    .filter(
      (w) => !enrolledIds.has(w.courseId) && w.status === CourseStatus.Published
    )
    .map((w) => ({
      ...w,
      pppPrice: w.pppEnabled ? calculatePppPrice(w.price, country) : w.price,
    }));

  return { items };
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <Skeleton className="h-9 w-48" />
      <Skeleton className="mt-2 h-5 w-64" />
      <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-72 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}

export default function Wishlist({ loaderData }: Route.ComponentProps) {
  const { items } = loaderData;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Wishlist</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Your Wishlist</h1>
        <p className="mt-1 text-muted-foreground">
          Courses you saved to buy later
        </p>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Heart className="mb-4 size-12 text-muted-foreground/50" />
          <h2 className="text-lg font-medium">Your wishlist is empty</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Save courses from the catalog to come back to them later.
          </p>
          <Link to="/courses" className="mt-4">
            <Button>Browse Courses</Button>
          </Link>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <Card key={item.id} className="flex flex-col overflow-hidden pt-0">
              <Link
                to={`/courses/${item.slug}`}
                className="aspect-video overflow-hidden"
              >
                <CourseImage
                  src={item.coverImageUrl}
                  alt={item.title}
                  className="h-full w-full object-cover transition-transform hover:scale-105"
                />
              </Link>
              <CardHeader>
                <Link
                  to={`/courses/${item.slug}`}
                  className="text-lg font-semibold leading-tight hover:text-primary"
                >
                  {item.title}
                </Link>
                <p className="line-clamp-2 text-sm text-muted-foreground">
                  {item.description}
                </p>
              </CardHeader>
              <CardContent className="flex-1">
                <div className="text-sm text-muted-foreground">
                  {item.instructorName}
                </div>
                <div className="mt-2 font-semibold">
                  {item.pppPrice < item.price ? (
                    <span className="flex items-center gap-1.5">
                      <span className="text-xs font-normal text-muted-foreground line-through">
                        {formatPrice(item.price)}
                      </span>
                      {formatPrice(item.pppPrice)}
                    </span>
                  ) : (
                    formatPrice(item.price)
                  )}
                </div>
              </CardContent>
              <CardFooter className="flex-col gap-2">
                <Link to={`/courses/${item.slug}/purchase`} className="w-full">
                  <Button className="w-full">
                    <ShoppingCart className="mr-2 size-4" />
                    Buy Now
                  </Button>
                </Link>
                <WishlistButton courseId={item.courseId} wishlisted={true} />
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading your wishlist.";

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
