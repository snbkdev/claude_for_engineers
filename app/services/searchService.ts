import { eq, and, or, like, type AnyColumn } from "drizzle-orm";
import { db } from "~/db";
import {
  courses,
  lessons,
  modules,
  users,
  CourseStatus,
  UserRole,
} from "~/db/schema";

// ─── Search Service ───
// Full-text-style search over courses, lessons, and authors using SQLite LIKE
// for candidate selection + a weighted JS scorer for ranking. A query is split
// into terms; matching is AND across terms (every term must appear in some
// field) and scoring weights stronger fields (title/name) above weaker ones
// (description/content/bio). Pure helpers (parseQuery/scoreEntity/makeSnippet)
// carry the ranking logic and are unit-tested independently of the DB.

const RESULTS_PER_TYPE = 20;

export type SearchField = { text: string; weight: number };

export interface SearchResults {
  query: string;
  terms: string[];
  courses: Array<{
    id: number;
    title: string;
    slug: string;
    description: string;
    instructorName: string;
    coverImageUrl: string | null;
    score: number;
  }>;
  lessons: Array<{
    id: number;
    title: string;
    courseSlug: string;
    courseTitle: string;
    moduleTitle: string;
    snippet: string;
    score: number;
  }>;
  authors: Array<{
    id: number;
    name: string;
    avatarUrl: string | null;
    bio: string | null;
    score: number;
  }>;
  total: number;
}

// Split a raw query into normalized, de-duplicated lowercase terms.
export function parseQuery(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/\s+/)
        .map((t) => t.trim())
        .filter(Boolean)
    ),
  ];
}

// Score an entity against the terms. Returns null when not every term is found
// (AND semantics); otherwise the sum, per term, of the heaviest field the term
// appears in. Higher is more relevant.
export function scoreEntity(
  fields: SearchField[],
  terms: string[]
): number | null {
  if (terms.length === 0) return null;

  let score = 0;
  for (const term of terms) {
    let best = 0;
    for (const field of fields) {
      if (field.text && field.text.toLowerCase().includes(term)) {
        if (field.weight > best) best = field.weight;
      }
    }
    if (best === 0) return null; // term missing everywhere → no match
    score += best;
  }
  return score;
}

// Build a short snippet windowed around the first matched term, with ellipses.
// Whitespace/newlines are collapsed so markdown content reads cleanly inline.
export function makeSnippet(
  text: string,
  terms: string[],
  maxLen = 160
): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;

  const lower = clean.toLowerCase();
  let firstIdx = -1;
  for (const term of terms) {
    const idx = lower.indexOf(term);
    if (idx !== -1 && (firstIdx === -1 || idx < firstIdx)) firstIdx = idx;
  }

  if (firstIdx === -1) return clean.slice(0, maxLen).trimEnd() + "…";

  const start = Math.max(0, firstIdx - 40);
  const end = Math.min(clean.length, start + maxLen);
  let snippet = clean.slice(start, end).trim();
  if (start > 0) snippet = "…" + snippet;
  if (end < clean.length) snippet = snippet + "…";
  return snippet;
}

// LIKE candidate filter: OR every term across every column.
function likeAny(columns: AnyColumn[], terms: string[]) {
  const conds = terms.flatMap((t) => columns.map((col) => like(col, `%${t}%`)));
  return or(...conds)!;
}

function searchCourses(terms: string[]): SearchResults["courses"] {
  const rows = db
    .select({
      id: courses.id,
      title: courses.title,
      slug: courses.slug,
      description: courses.description,
      salesCopy: courses.salesCopy,
      coverImageUrl: courses.coverImageUrl,
      instructorName: users.name,
    })
    .from(courses)
    .innerJoin(users, eq(courses.instructorId, users.id))
    .where(
      and(
        eq(courses.status, CourseStatus.Published),
        likeAny([courses.title, courses.description, courses.salesCopy], terms)
      )
    )
    .all();

  return rows
    .map((r) => {
      const score = scoreEntity(
        [
          { text: r.title, weight: 5 },
          { text: r.description, weight: 2 },
          { text: r.salesCopy ?? "", weight: 1 },
        ],
        terms
      );
      return score === null ? null : { ...r, score };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, RESULTS_PER_TYPE)
    .map(({ salesCopy: _salesCopy, ...rest }) => rest);
}

function searchLessons(terms: string[]): SearchResults["lessons"] {
  const rows = db
    .select({
      id: lessons.id,
      title: lessons.title,
      content: lessons.content,
      moduleTitle: modules.title,
      courseSlug: courses.slug,
      courseTitle: courses.title,
    })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(
      and(
        eq(courses.status, CourseStatus.Published),
        likeAny([lessons.title, lessons.content], terms)
      )
    )
    .all();

  return rows
    .map((r) => {
      const score = scoreEntity(
        [
          { text: r.title, weight: 4 },
          { text: r.content ?? "", weight: 1 },
        ],
        terms
      );
      if (score === null) return null;
      return {
        id: r.id,
        title: r.title,
        courseSlug: r.courseSlug,
        courseTitle: r.courseTitle,
        moduleTitle: r.moduleTitle,
        snippet: makeSnippet(r.content ?? "", terms),
        score,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, RESULTS_PER_TYPE);
}

function searchAuthors(terms: string[]): SearchResults["authors"] {
  const rows = db
    .select({
      id: users.id,
      name: users.name,
      avatarUrl: users.avatarUrl,
      bio: users.bio,
    })
    .from(users)
    .where(
      and(
        eq(users.role, UserRole.Instructor),
        likeAny([users.name, users.bio], terms)
      )
    )
    .all();

  return rows
    .map((r) => {
      const score = scoreEntity(
        [
          { text: r.name, weight: 5 },
          { text: r.bio ?? "", weight: 1 },
        ],
        terms
      );
      return score === null ? null : { ...r, score };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, RESULTS_PER_TYPE);
}

// Entry point: run all three searches for a raw query. An empty/whitespace
// query yields empty results.
export function search(query: string): SearchResults {
  const terms = parseQuery(query);

  if (terms.length === 0) {
    return { query, terms, courses: [], lessons: [], authors: [], total: 0 };
  }

  const courseResults = searchCourses(terms);
  const lessonResults = searchLessons(terms);
  const authorResults = searchAuthors(terms);

  return {
    query,
    terms,
    courses: courseResults,
    lessons: lessonResults,
    authors: authorResults,
    total: courseResults.length + lessonResults.length + authorResults.length,
  };
}
