import { data } from "react-router";
import type { Route } from "./+types/api.wishlist";
import { getCurrentUserId } from "~/lib/session";
import { toggleWishlist } from "~/services/wishlistService";

// Toggles a course on the current user's wishlist. POST { courseId }.
// Submissions revalidate the calling page's loaders, so callers can rely on the
// refreshed `wishlisted` state after the fetcher settles.
export async function action({ request }: Route.ActionArgs) {
  const userId = await getCurrentUserId(request);
  if (!userId) {
    return data({ error: "You must be logged in." }, { status: 401 });
  }

  const formData = await request.formData();
  const courseId = Number(formData.get("courseId"));
  if (Number.isNaN(courseId)) {
    return data({ error: "Invalid course." }, { status: 400 });
  }

  return toggleWishlist({ userId, courseId });
}
