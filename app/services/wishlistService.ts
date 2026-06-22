import { eq, and, desc } from "drizzle-orm";
import { db } from "~/db";
import { wishlistItems, courses, users } from "~/db/schema";

// ─── Wishlist Service ───
// Course-level "save for later". One row per (user, course); toggled from the
// catalog/course page and listed on the dedicated wishlist page + dashboard.
// Functions with multiple same-typed params take a single object param.

function findItem(opts: { userId: number; courseId: number }) {
  return db
    .select()
    .from(wishlistItems)
    .where(
      and(
        eq(wishlistItems.userId, opts.userId),
        eq(wishlistItems.courseId, opts.courseId)
      )
    )
    .get();
}

export function isWishlisted(opts: { userId: number; courseId: number }) {
  return !!findItem(opts);
}

// Adds the course if missing, removes it if present. Returns whether the course
// is on the wishlist after the toggle.
export function toggleWishlist(opts: { userId: number; courseId: number }) {
  if (findItem(opts)) {
    db.delete(wishlistItems)
      .where(
        and(
          eq(wishlistItems.userId, opts.userId),
          eq(wishlistItems.courseId, opts.courseId)
        )
      )
      .run();
    return { wishlisted: false };
  }

  db.insert(wishlistItems)
    .values({ userId: opts.userId, courseId: opts.courseId })
    .run();
  return { wishlisted: true };
}

export function removeFromWishlist(opts: { userId: number; courseId: number }) {
  db.delete(wishlistItems)
    .where(
      and(
        eq(wishlistItems.userId, opts.userId),
        eq(wishlistItems.courseId, opts.courseId)
      )
    )
    .run();
}

// Course IDs the user has wishlisted — for batch state on the catalog grid.
export function getWishlistCourseIds(userId: number) {
  return db
    .select({ courseId: wishlistItems.courseId })
    .from(wishlistItems)
    .where(eq(wishlistItems.userId, userId))
    .all()
    .map((row) => row.courseId);
}

// Wishlisted courses joined with course + instructor details, newest first.
// Callers (dashboard / wishlist page) drop already-enrolled or unpublished
// courses and apply PPP pricing with the request country.
export function getWishlist(userId: number) {
  return db
    .select({
      id: wishlistItems.id,
      courseId: courses.id,
      title: courses.title,
      slug: courses.slug,
      description: courses.description,
      coverImageUrl: courses.coverImageUrl,
      price: courses.price,
      pppEnabled: courses.pppEnabled,
      status: courses.status,
      instructorId: courses.instructorId,
      instructorName: users.name,
      createdAt: wishlistItems.createdAt,
    })
    .from(wishlistItems)
    .innerJoin(courses, eq(wishlistItems.courseId, courses.id))
    .innerJoin(users, eq(courses.instructorId, users.id))
    .where(eq(wishlistItems.userId, userId))
    .orderBy(desc(wishlistItems.createdAt), desc(wishlistItems.id))
    .all();
}
