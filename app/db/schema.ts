import {
  sqliteTable,
  text,
  integer,
  real,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

export enum UserRole {
  Student = "student",
  Instructor = "instructor",
  Admin = "admin",
}

export enum CourseStatus {
  Draft = "draft",
  Published = "published",
  Archived = "archived",
}

export enum LessonProgressStatus {
  NotStarted = "not_started",
  InProgress = "in_progress",
  Completed = "completed",
}

export enum QuestionType {
  MultipleChoice = "multiple_choice",
  TrueFalse = "true_false",
  MultiSelect = "multi_select",
}

export enum TeamMemberRole {
  Admin = "admin",
  Member = "member",
}

// Generic notification kinds. Starts with "enrollment"; designed to grow
// (comments, ratings, quiz completions, …) without a schema change.
export enum NotificationType {
  Enrollment = "enrollment",
  CouponRedemption = "coupon_redemption",
  Refund = "refund",
  GiftClaimed = "gift_claimed",
  PurchaseConfirmation = "purchase_confirmation",
}

export enum EmailStatus {
  Pending = "pending",
  Sent = "sent",
  Failed = "failed",
}

// ─── Tables ───

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: text("role").notNull().$type<UserRole>(),
  avatarUrl: text("avatar_url"),
  bio: text("bio"),
  // When true the user is hidden from the public leaderboard (and doesn't see
  // their own rank). Opt-out privacy, default visible.
  leaderboardOptOut: integer("leaderboard_opt_out", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
});

export const courses = sqliteTable("courses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description").notNull(),
  salesCopy: text("sales_copy"),
  instructorId: integer("instructor_id")
    .notNull()
    .references(() => users.id),
  categoryId: integer("category_id")
    .notNull()
    .references(() => categories.id),
  status: text("status").notNull().$type<CourseStatus>(),
  coverImageUrl: text("cover_image_url"),
  price: integer("price").notNull().default(0),
  pppEnabled: integer("ppp_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  // Drip: when on, a lesson is locked until every earlier lesson (module then
  // position order) is completed. Off → all lessons open immediately.
  sequentialUnlock: integer("sequential_unlock", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const modules = sqliteTable("modules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  courseId: integer("course_id")
    .notNull()
    .references(() => courses.id),
  title: text("title").notNull(),
  position: integer("position").notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const lessons = sqliteTable("lessons", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  moduleId: integer("module_id")
    .notNull()
    .references(() => modules.id),
  title: text("title").notNull(),
  content: text("content"),
  videoUrl: text("video_url"),
  githubRepoUrl: text("github_repo_url"),
  position: integer("position").notNull(),
  durationMinutes: integer("duration_minutes"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const enrollments = sqliteTable("enrollments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  courseId: integer("course_id")
    .notNull()
    .references(() => courses.id),
  enrolledAt: text("enrolled_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  completedAt: text("completed_at"),
});

export const lessonProgress = sqliteTable("lesson_progress", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  lessonId: integer("lesson_id")
    .notNull()
    .references(() => lessons.id),
  status: text("status").notNull().$type<LessonProgressStatus>(),
  completedAt: text("completed_at"),
});

export const quizzes = sqliteTable("quizzes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  lessonId: integer("lesson_id")
    .notNull()
    .references(() => lessons.id),
  title: text("title").notNull(),
  passingScore: real("passing_score").notNull(),
});

export const quizQuestions = sqliteTable("quiz_questions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  quizId: integer("quiz_id")
    .notNull()
    .references(() => quizzes.id),
  questionText: text("question_text").notNull(),
  questionType: text("question_type").notNull().$type<QuestionType>(),
  position: integer("position").notNull(),
});

export const quizOptions = sqliteTable("quiz_options", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  questionId: integer("question_id")
    .notNull()
    .references(() => quizQuestions.id),
  optionText: text("option_text").notNull(),
  isCorrect: integer("is_correct", { mode: "boolean" }).notNull(),
});

export const quizAttempts = sqliteTable("quiz_attempts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  quizId: integer("quiz_id")
    .notNull()
    .references(() => quizzes.id),
  score: real("score").notNull(),
  passed: integer("passed", { mode: "boolean" }).notNull(),
  attemptedAt: text("attempted_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const quizAnswers = sqliteTable("quiz_answers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  attemptId: integer("attempt_id")
    .notNull()
    .references(() => quizAttempts.id),
  questionId: integer("question_id")
    .notNull()
    .references(() => quizQuestions.id),
  selectedOptionId: integer("selected_option_id")
    .notNull()
    .references(() => quizOptions.id),
});

export const purchases = sqliteTable("purchases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  courseId: integer("course_id")
    .notNull()
    .references(() => courses.id),
  pricePaid: integer("price_paid").notNull(),
  country: text("country"),
  // Set when the purchase is refunded/cancelled (enrollment/coupons unwound).
  refundedAt: text("refunded_at"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const teams = sqliteTable("teams", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const teamMembers = sqliteTable("team_members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teamId: integer("team_id")
    .notNull()
    .references(() => teams.id),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  role: text("role").notNull().$type<TeamMemberRole>(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const coupons = sqliteTable("coupons", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teamId: integer("team_id")
    .notNull()
    .references(() => teams.id),
  courseId: integer("course_id")
    .notNull()
    .references(() => courses.id),
  code: text("code").notNull().unique(),
  purchaseId: integer("purchase_id")
    .notNull()
    .references(() => purchases.id),
  redeemedByUserId: integer("redeemed_by_user_id").references(() => users.id),
  redeemedAt: text("redeemed_at"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// Course gifts ("buy as a gift"). The sender pays (a `purchases` row); a gift
// row holds a unique claim `code` and the intended recipient's email. Anyone
// logged in who opens the link can claim it (the email is informational), which
// enrolls the claimer. One claim per gift.
export const gifts = sqliteTable("gifts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  purchaseId: integer("purchase_id")
    .notNull()
    .references(() => purchases.id),
  courseId: integer("course_id")
    .notNull()
    .references(() => courses.id),
  senderId: integer("sender_id")
    .notNull()
    .references(() => users.id),
  recipientEmail: text("recipient_email").notNull(),
  message: text("message"),
  code: text("code").notNull().unique(),
  claimedByUserId: integer("claimed_by_user_id").references(() => users.id),
  claimedAt: text("claimed_at"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const videoWatchEvents = sqliteTable("video_watch_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  lessonId: integer("lesson_id")
    .notNull()
    .references(() => lessons.id),
  eventType: text("event_type").notNull(),
  positionSeconds: real("position_seconds").notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// Comments students leave on lessons. Instructors reply via the self-referencing
// parentId (a reply is a comment whose parent is another comment).
export const lessonComments = sqliteTable("lesson_comments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  lessonId: integer("lesson_id")
    .notNull()
    .references(() => lessons.id),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  parentId: integer("parent_id").references(
    (): AnySQLiteColumn => lessonComments.id
  ),
  content: text("content").notNull(),
  // Top-level comments may be flagged as questions for the Q&A view (filter +
  // "answered by instructor" badge). Replies are never questions.
  isQuestion: integer("is_question", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// Up/down votes on lesson comments (one per user per comment, value +1 or −1).
// Drives the "most helpful" sort. Uniqueness per (commentId, userId) is enforced
// in the service via check-then-update (no composite constraint).
export const commentReactions = sqliteTable("comment_reactions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  commentId: integer("comment_id")
    .notNull()
    .references(() => lessonComments.id),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  value: integer("value").notNull(), // +1 (up) or −1 (down)
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// Private per-student bookmarks on individual lessons. They persist until the
// student removes them (even after the lesson is completed).
export const lessonBookmarks = sqliteTable("lesson_bookmarks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  lessonId: integer("lesson_id")
    .notNull()
    .references(() => lessons.id),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// Course-level wishlist ("save for later"). A student saves courses they intend
// to buy later; one row per (user, course), shown newest-first on their wishlist.
export const wishlistItems = sqliteTable("wishlist_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  courseId: integer("course_id")
    .notNull()
    .references(() => courses.id),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// Private per-student notes on individual lessons. A student can keep several
// notes per lesson and edit/delete them at will; only the author ever sees them.
export const lessonNotes = sqliteTable("lesson_notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  lessonId: integer("lesson_id")
    .notNull()
    .references(() => lessons.id),
  content: text("content").notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// Attachments/resources an instructor adds to a lesson (slides, source, links).
// `type` is a free-form label rendered with a generic icon.
export const lessonResources = sqliteTable("lesson_resources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  lessonId: integer("lesson_id")
    .notNull()
    .references(() => lessons.id),
  title: text("title").notNull(),
  url: text("url").notNull(),
  type: text("type"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// Earned achievements/badges. Each row records that a user has unlocked the
// achievement identified by `key`; the catalog of definitions (title,
// description, icon, unlock rule) lives in code (achievementService), so adding
// a new badge needs no migration. One row per (userId, key) — uniqueness is
// enforced in the service via check-then-insert (no composite constraint).
export const achievements = sqliteTable("achievements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  key: text("key").notNull(),
  earnedAt: text("earned_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// In-app notifications. Generic by design (type/title/message/linkUrl) so new
// event kinds can be added without touching the schema. Currently only
// enrollment notifications are produced, delivered to instructors.
export const notifications = sqliteTable("notifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  recipientUserId: integer("recipient_user_id")
    .notNull()
    .references(() => users.id),
  type: text("type").notNull().$type<NotificationType>(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  linkUrl: text("link_url").notNull(),
  isRead: integer("is_read", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// Email "outbox" — every in-app notification is mirrored to a queued email here
// (createNotification enqueues), then a dispatcher (flushEmailOutbox) sends them
// via the configured EmailAdapter and marks each sent/failed. Decoupling send
// from the request keeps notifications fast and makes delivery retryable.
export const emailOutbox = sqliteTable("email_outbox", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  recipientUserId: integer("recipient_user_id")
    .notNull()
    .references(() => users.id),
  toEmail: text("to_email").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  status: text("status")
    .notNull()
    .$type<EmailStatus>()
    .default(EmailStatus.Pending),
  attempts: integer("attempts").notNull().default(0),
  error: text("error"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  sentAt: text("sent_at"),
});

// Certificates issued when a student reaches 100% progress on a course. One per
// (userId, courseId); the unique `code` backs the public verification page and
// the PDF download. Issuance is idempotent (see certificateService).
export const certificates = sqliteTable("certificates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  courseId: integer("course_id")
    .notNull()
    .references(() => courses.id),
  code: text("code").notNull().unique(),
  issuedAt: text("issued_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const courseRatings = sqliteTable("course_ratings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  courseId: integer("course_id")
    .notNull()
    .references(() => courses.id),
  rating: integer("rating").notNull(), // 1-5
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export enum PromoDiscountType {
  Percent = "percent",
  Fixed = "fixed",
}

// Marketing promo codes — a global discount applied at checkout, distinct from
// the team seat `coupons`. A code is `percent` (1–100) or `fixed` (cents off),
// with an optional expiry and redemption limit. `redemptionCount` is the
// enforced usage counter (incremented inside the purchase transaction).
export const promoCodes = sqliteTable("promo_codes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(), // stored uppercase
  discountType: text("discount_type").notNull().$type<PromoDiscountType>(),
  discountValue: integer("discount_value").notNull(), // percent or cents
  maxRedemptions: integer("max_redemptions"), // null = unlimited
  redemptionCount: integer("redemption_count").notNull().default(0),
  expiresAt: text("expires_at"), // ISO, null = never
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});
