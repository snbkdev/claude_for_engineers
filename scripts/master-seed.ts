import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "path";
import { fileURLToPath } from "url";
import * as schema from "../app/db/schema";
import { UserRole, CourseStatus } from "../app/db/schema";

// ─── Master Seed ───
//
// A parameterized generator that wipes data.db and rebuilds a full, randomized
// dataset: 1 admin, a handful of instructors, N students, courses (with modules
// + lessons), and "sellings" (purchases + matching enrollments + ratings) spread
// over time so the analytics dashboard / revenue chart looks alive.
//
//   pnpm master-seed 50        # 50 students (the buyer count)
//   pnpm tsx scripts/master-seed.ts 50
//
// The single numeric argument is the number of students. Everything else
// (instructor count, course count) scales from it.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsFolder = path.resolve(__dirname, "../drizzle");

// ─── Args ───

const rawArg = process.argv[2];
const parsed = Number(rawArg);
const STUDENT_COUNT = Number.isFinite(parsed)
  ? Math.min(Math.max(Math.trunc(parsed), 1), 2000)
  : 30;

// ─── Random helpers ───

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle<T>(arr: readonly T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function chance(probability: number): boolean {
  return Math.random() < probability;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  // randomize the time-of-day a little so events don't all stack at midnight
  d.setUTCHours(randInt(7, 21), randInt(0, 59), randInt(0, 59), 0);
  return d.toISOString();
}

// Weighted toward the last 30 days so the default analytics window is populated,
// with a long tail across ~120 days for the "all time" view.
function recentSaleDate(): string {
  return chance(0.6)
    ? isoDaysAgo(randInt(0, 30))
    : isoDaysAgo(randInt(31, 120));
}

// ─── Name pools ───

const FIRST_NAMES = [
  "Emma",
  "Liam",
  "Olivia",
  "Noah",
  "Ava",
  "James",
  "Sophia",
  "Lucas",
  "Mia",
  "Mason",
  "Isabella",
  "Ethan",
  "Amelia",
  "Logan",
  "Harper",
  "Aiden",
  "Evelyn",
  "Jackson",
  "Abigail",
  "Sebastian",
  "Ella",
  "Daniel",
  "Scarlett",
  "Matthew",
  "Grace",
  "Henry",
  "Chloe",
  "Owen",
  "Lily",
  "Wyatt",
  "Aria",
  "Carter",
  "Riley",
  "Julian",
  "Zoe",
  "Leo",
  "Nora",
  "Hudson",
  "Hazel",
  "Asher",
  "Layla",
  "Gabriel",
  "Mila",
  "Anthony",
  "Aaliyah",
  "Dylan",
  "Penelope",
  "Isaac",
  "Stella",
  "Aditya",
  "Priya",
  "Wei",
  "Mei",
  "Kenji",
  "Yuki",
  "Omar",
  "Fatima",
  "Diego",
  "Sofia",
  "Ivan",
  "Anya",
] as const;

const LAST_NAMES = [
  "Smith",
  "Johnson",
  "Williams",
  "Brown",
  "Jones",
  "Garcia",
  "Miller",
  "Davis",
  "Rodriguez",
  "Martinez",
  "Hernandez",
  "Lopez",
  "Gonzalez",
  "Wilson",
  "Anderson",
  "Thomas",
  "Taylor",
  "Moore",
  "Jackson",
  "Martin",
  "Lee",
  "Perez",
  "Thompson",
  "White",
  "Harris",
  "Sanchez",
  "Clark",
  "Ramirez",
  "Lewis",
  "Robinson",
  "Walker",
  "Young",
  "Allen",
  "King",
  "Wright",
  "Scott",
  "Torres",
  "Nguyen",
  "Hill",
  "Flores",
  "Patel",
  "Chen",
  "Kim",
  "Singh",
  "Kumar",
  "Ali",
  "Khan",
  "Sato",
  "Tanaka",
  "Petrov",
] as const;

const COUNTRY_CODES = [
  "US",
  "US",
  "US",
  "GB",
  "CA",
  "AU",
  "DE",
  "FR",
  "IN",
  "BR",
  "MX",
  "JP",
  "SG",
  "NL",
  "SE",
  "PL",
  "TR",
  "ZA",
  "NG",
  "VN",
] as const;

// PPP-eligible markets that should attract a discount.
const PPP_COUNTRIES = ["IN", "BR", "MX", "TR", "ZA", "NG", "VN", "PL"];

const PRICE_TIERS = [2999, 3999, 4999, 5999, 6999, 7999, 8999, 9999] as const;

// ─── Course templates ───

const COURSE_TEMPLATES: {
  title: string;
  category: string;
  blurb: string;
}[] = [
  {
    title: "Introduction to TypeScript",
    category: "programming",
    blurb: "Master TypeScript from type annotations to advanced generics.",
  },
  {
    title: "Building REST APIs with Node.js",
    category: "programming",
    blurb: "Design, build, and ship production-grade REST APIs.",
  },
  {
    title: "React from Zero to Hero",
    category: "programming",
    blurb: "Build modern, component-driven UIs with React.",
  },
  {
    title: "Advanced SQL & Database Design",
    category: "data-science",
    blurb: "Model data and write fast, correct queries.",
  },
  {
    title: "Python for Data Analysis",
    category: "data-science",
    blurb: "Crunch data with pandas, NumPy, and friends.",
  },
  {
    title: "Machine Learning Foundations",
    category: "data-science",
    blurb: "The math and intuition behind modern ML.",
  },
  {
    title: "UI/UX Design Principles",
    category: "design",
    blurb: "Design interfaces people love to use.",
  },
  {
    title: "Figma for Product Teams",
    category: "design",
    blurb: "From wireframe to polished prototype in Figma.",
  },
  {
    title: "Docker & Kubernetes in Practice",
    category: "devops",
    blurb: "Containerize and orchestrate real workloads.",
  },
  {
    title: "CI/CD with GitHub Actions",
    category: "devops",
    blurb: "Automate testing and deployment pipelines.",
  },
  {
    title: "Infrastructure as Code with Terraform",
    category: "devops",
    blurb: "Provision cloud infrastructure reproducibly.",
  },
  {
    title: "Growth Marketing Essentials",
    category: "marketing",
    blurb: "Acquire, activate, and retain users.",
  },
  {
    title: "SEO that Actually Works",
    category: "marketing",
    blurb: "Rank higher with technical and content SEO.",
  },
  {
    title: "Rust for JavaScript Developers",
    category: "programming",
    blurb: "Learn Rust by leaning on what you already know.",
  },
  {
    title: "GraphQL End to End",
    category: "programming",
    blurb: "Schema design, resolvers, and client integration.",
  },
  {
    title: "System Design Interview Prep",
    category: "programming",
    blurb: "Reason about scale, tradeoffs, and reliability.",
  },
  {
    title: "Data Visualization with D3",
    category: "data-science",
    blurb: "Turn raw data into compelling visuals.",
  },
  {
    title: "Cloud Architecture on AWS",
    category: "devops",
    blurb: "Design resilient, cost-effective AWS systems.",
  },
  {
    title: "Brand Strategy & Storytelling",
    category: "marketing",
    blurb: "Build a brand that resonates.",
  },
  {
    title: "Accessibility for the Web",
    category: "design",
    blurb: "Build inclusive, WCAG-compliant experiences.",
  },
];

const MODULE_TITLES = [
  "Getting Started",
  "Core Concepts",
  "Going Deeper",
  "Patterns & Best Practices",
  "Real-World Projects",
  "Advanced Techniques",
];

const LESSON_TITLES = [
  "Overview & Setup",
  "The Mental Model",
  "Your First Example",
  "Common Pitfalls",
  "Hands-On Walkthrough",
  "Tips from the Field",
  "Putting It All Together",
  "Exercises",
];

// ─── DB setup ───

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
const db = drizzle(sqlite, { schema });

function resetSchema() {
  sqlite.exec(`
    DROP TABLE IF EXISTS notifications;
    DROP TABLE IF EXISTS lesson_bookmarks;
    DROP TABLE IF EXISTS lesson_comments;
    DROP TABLE IF EXISTS video_watch_events;
    DROP TABLE IF EXISTS quiz_answers;
    DROP TABLE IF EXISTS quiz_attempts;
    DROP TABLE IF EXISTS quiz_options;
    DROP TABLE IF EXISTS quiz_questions;
    DROP TABLE IF EXISTS quizzes;
    DROP TABLE IF EXISTS lesson_progress;
    DROP TABLE IF EXISTS course_ratings;
    DROP TABLE IF EXISTS coupons;
    DROP TABLE IF EXISTS team_members;
    DROP TABLE IF EXISTS teams;
    DROP TABLE IF EXISTS purchases;
    DROP TABLE IF EXISTS enrollments;
    DROP TABLE IF EXISTS lessons;
    DROP TABLE IF EXISTS modules;
    DROP TABLE IF EXISTS courses;
    DROP TABLE IF EXISTS categories;
    DROP TABLE IF EXISTS users;
    DROP TABLE IF EXISTS __drizzle_migrations;
  `);
  migrate(db, { migrationsFolder });
}

function avatar(seed: string): string {
  return `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(seed)}`;
}

function main() {
  console.log(`Master seed → ${STUDENT_COUNT} students…`);
  resetSchema();

  // ─── Admin ───
  const [admin] = db
    .insert(schema.users)
    .values({
      name: "Alex Rivera",
      email: "alex.rivera@ralph.dev",
      role: UserRole.Admin,
      avatarUrl: avatar("alex"),
      createdAt: isoDaysAgo(150),
    })
    .returning()
    .all();

  // ─── Instructors ───
  const instructorCount = Math.min(
    Math.max(Math.round(STUDENT_COUNT / 12), 3),
    10
  );
  const usedNames = new Set<string>();
  function uniqueName(): string {
    for (let i = 0; i < 200; i++) {
      const name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
      if (!usedNames.has(name)) {
        usedNames.add(name);
        return name;
      }
    }
    return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)} ${randInt(1, 9999)}`;
  }

  const instructors = Array.from({ length: instructorCount }).map((_, i) => {
    const name = uniqueName();
    return db
      .insert(schema.users)
      .values({
        name,
        email: `${slugify(name)}.${i}@instructor.dev`,
        role: UserRole.Instructor,
        avatarUrl: avatar(name),
        bio: `${name} is an experienced practitioner and educator who loves teaching by example.`,
        createdAt: isoDaysAgo(randInt(100, 140)),
      })
      .returning()
      .get();
  });

  // ─── Categories ───
  const categories = db
    .insert(schema.categories)
    .values([
      { name: "Programming", slug: "programming" },
      { name: "Design", slug: "design" },
      { name: "Data Science", slug: "data-science" },
      { name: "DevOps", slug: "devops" },
      { name: "Marketing", slug: "marketing" },
    ])
    .returning()
    .all();
  const catBySlug = Object.fromEntries(categories.map((c) => [c.slug, c]));

  // ─── Courses (with modules + lessons) ───
  // Roughly two courses per instructor, capped by the template pool.
  const courseCount = Math.min(
    instructorCount * 2 + 2,
    COURSE_TEMPLATES.length
  );
  const templates = shuffle(COURSE_TEMPLATES).slice(0, courseCount);
  const usedSlugs = new Set<string>();

  const courses = templates.map((tpl, idx) => {
    let slug = slugify(tpl.title);
    while (usedSlugs.has(slug)) slug = `${slug}-${randInt(2, 99)}`;
    usedSlugs.add(slug);

    const instructor = pick(instructors);
    // Most courses published; a couple left as draft for realism.
    const status =
      idx < courseCount - 2 ? CourseStatus.Published : CourseStatus.Draft;

    const course = db
      .insert(schema.courses)
      .values({
        title: tpl.title,
        slug,
        description: tpl.blurb,
        salesCopy: `## ${tpl.title}\n\n${tpl.blurb}\n\nLearn by building real projects, at your own pace.`,
        instructorId: instructor.id,
        categoryId: catBySlug[tpl.category].id,
        status,
        coverImageUrl: "/images/course-typescript.svg",
        price: pick(PRICE_TIERS),
        createdAt: isoDaysAgo(randInt(60, 130)),
        updatedAt: isoDaysAgo(randInt(0, 30)),
      })
      .returning()
      .get();

    // Modules + lessons
    const moduleCount = randInt(2, 4);
    const moduleTitles = shuffle(MODULE_TITLES).slice(0, moduleCount);
    moduleTitles.forEach((mTitle, mPos) => {
      const mod = db
        .insert(schema.modules)
        .values({ courseId: course.id, title: mTitle, position: mPos })
        .returning()
        .get();
      const lessonCount = randInt(3, 5);
      const lessonTitles = shuffle(LESSON_TITLES).slice(0, lessonCount);
      lessonTitles.forEach((lTitle, lPos) => {
        db.insert(schema.lessons)
          .values({
            moduleId: mod.id,
            title: lTitle,
            content: `## ${lTitle}\n\nContent for ${course.title} — ${lTitle}.`,
            videoUrl: "https://www.youtube.com/watch?v=zQnBQ4tB3ZA",
            position: lPos,
            durationMinutes: randInt(6, 22),
          })
          .run();
      });
    });

    return course;
  });

  const publishedCourses = courses.filter(
    (c) => c.status === CourseStatus.Published
  );

  // ─── Students ───
  const students = Array.from({ length: STUDENT_COUNT }).map((_, i) => {
    const name = uniqueName();
    return db
      .insert(schema.users)
      .values({
        name,
        email: `${slugify(name)}.${i}@student.dev`,
        role: UserRole.Student,
        avatarUrl: avatar(name),
        createdAt: isoDaysAgo(randInt(0, 120)),
      })
      .returning()
      .get();
  });

  // ─── Sellings: purchases + enrollments + ratings ───
  let purchaseCount = 0;
  let enrollmentCount = 0;
  let ratingCount = 0;

  for (const student of students) {
    // Each student buys 1–4 distinct published courses.
    const buyCount = Math.min(randInt(1, 4), publishedCourses.length);
    const bought = shuffle(publishedCourses).slice(0, buyCount);

    for (const course of bought) {
      const date = recentSaleDate();
      const country = pick(COUNTRY_CODES);
      // PPP markets sometimes pay a discounted price.
      const pricePaid =
        PPP_COUNTRIES.includes(country) && chance(0.7)
          ? Math.round((course.price * randInt(40, 60)) / 100)
          : course.price;

      db.insert(schema.purchases)
        .values({
          userId: student.id,
          courseId: course.id,
          pricePaid,
          country,
          createdAt: date,
        })
        .run();
      purchaseCount++;

      db.insert(schema.enrollments)
        .values({
          userId: student.id,
          courseId: course.id,
          enrolledAt: date,
          completedAt: chance(0.25) ? isoDaysAgo(randInt(0, 20)) : null,
        })
        .run();
      enrollmentCount++;

      // Many buyers leave a rating.
      if (chance(0.65)) {
        db.insert(schema.courseRatings)
          .values({
            userId: student.id,
            courseId: course.id,
            rating: pick([3, 4, 4, 5, 5, 5]),
            createdAt: date,
            updatedAt: date,
          })
          .run();
        ratingCount++;
      }
    }
  }

  console.log("─".repeat(48));
  console.log(`✔ 1 admin (Alex Rivera — log in as this user)`);
  console.log(`✔ ${instructors.length} instructors`);
  console.log(
    `✔ ${courses.length} courses (${publishedCourses.length} published)`
  );
  console.log(`✔ ${students.length} students`);
  console.log(`✔ ${purchaseCount} purchases / ${enrollmentCount} enrollments`);
  console.log(`✔ ${ratingCount} ratings`);
  console.log("Done.");
}

main();
