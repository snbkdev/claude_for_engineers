import {
  type RouteConfig,
  index,
  route,
  layout,
} from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  layout("routes/layout.app.tsx", [
    route("dashboard", "routes/dashboard.tsx"),
    route("leaderboard", "routes/leaderboard.tsx"),
    route("u/:userId", "routes/u.$userId.tsx"),
    route("notes", "routes/notes.tsx"),
    route("courses", "routes/courses.tsx"),
    route("courses/:slug", "routes/courses.$slug.tsx"),
    route("courses/:slug/:moduleId", "routes/courses.$slug.$moduleId.tsx"),
    route("courses/:slug/purchase", "routes/courses.$slug.purchase.tsx"),
    route("courses/:slug/gift", "routes/courses.$slug.gift.tsx"),
    route("courses/:slug/welcome", "routes/courses.$slug.welcome.tsx"),
    route(
      "courses/:slug/lessons/:lessonId",
      "routes/courses.$slug.lessons.$lessonId.tsx"
    ),
    route("instructor", "routes/instructor.tsx"),
    route("instructor/analytics", "routes/instructor.analytics.tsx"),
    route("instructor/new", "routes/instructor.new.tsx"),
    route("instructor/:courseId", "routes/instructor.$courseId.tsx"),
    route(
      "instructor/:courseId/lessons/:lessonId",
      "routes/instructor.$courseId.lessons.$lessonId.tsx"
    ),
    route(
      "instructor/:courseId/lessons/:lessonId/quiz",
      "routes/instructor.$courseId.lessons.$lessonId.quiz.tsx"
    ),
    route(
      "instructor/:courseId/modules/:moduleId",
      "routes/instructor.$courseId.modules.$moduleId.tsx"
    ),
    route(
      "instructor/:courseId/students",
      "routes/instructor.$courseId.students.tsx"
    ),
    route("admin/analytics", "routes/admin.analytics.tsx"),
    route("admin/users", "routes/admin.users.tsx"),
    route("admin/courses", "routes/admin.courses.tsx"),
    route("admin/moderation", "routes/admin.moderation.tsx"),
    route("admin/categories", "routes/admin.categories.tsx"),
    route("admin/promos", "routes/admin.promos.tsx"),
    route("admin/purchases", "routes/admin.purchases.tsx"),
    route("admin/emails", "routes/admin.emails.tsx"),
    route("settings", "routes/settings.tsx"),
    route("team", "routes/team.tsx"),
    route("wishlist", "routes/wishlist.tsx"),
    route("gifts", "routes/gifts.tsx"),
    route("redeem/:code", "routes/redeem.$code.tsx"),
    route("gift/:code", "routes/gift.$code.tsx"),
  ]),
  route("signup", "routes/signup.tsx"),
  route("login", "routes/login.tsx"),
  // ─── Public certificate verification + PDF download ───
  route("certificates/:code", "routes/certificates.$code.tsx"),
  route("certificates/:code/pdf", "routes/certificates.$code.pdf.ts"),
  // ─── Live presence (SSE): "N watching this lesson now" ───
  route(
    "api/lessons/:lessonId/presence",
    "routes/api.lessons.$lessonId.presence.ts"
  ),
  route("api/switch-user", "routes/api.switch-user.ts"),
  route("api/logout", "routes/api.logout.ts"),
  route("api/video-tracking", "routes/api.video-tracking.ts"),
  route("api/wishlist", "routes/api.wishlist.ts"),
  route("api/analytics/export", "routes/api.analytics.export.ts"),
  route("api/set-dev-country", "routes/api.set-dev-country.ts"),
  route("api/notifications/mark-read", "routes/api.notifications.mark-read.ts"),
  route(
    "api/notifications/mark-all-read",
    "routes/api.notifications.mark-all-read.ts"
  ),
] satisfies RouteConfig;
