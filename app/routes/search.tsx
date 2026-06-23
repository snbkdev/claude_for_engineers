import { Form, Link } from "react-router";
import type { Route } from "./+types/search";
import { search } from "~/services/searchService";
import { Highlight } from "~/components/highlight";
import { UserAvatar } from "~/components/user-avatar";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  BookOpen,
  FileText,
  GraduationCap,
  Search as SearchIcon,
} from "lucide-react";

export function meta({ data }: Route.MetaArgs) {
  const q = data?.results.query;
  return [
    { title: q ? `Search: ${q} — Cadence` : "Search — Cadence" },
    { name: "description", content: "Search courses, lessons, and authors" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  return { results: search(q) };
}

export default function SearchPage({ loaderData }: Route.ComponentProps) {
  const { results } = loaderData;
  const { query, terms, courses, lessons, authors, total } = results;
  const hasQuery = terms.length > 0;

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Search</h1>
        <p className="mt-1 text-muted-foreground">
          Find courses, lessons, and authors
        </p>
      </div>

      <Form method="get" className="mb-8 flex gap-2">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="q"
            defaultValue={query}
            placeholder="Search for anything…"
            className="pl-9"
            autoFocus
          />
        </div>
        <Button type="submit">Search</Button>
      </Form>

      {!hasQuery ? (
        <Card>
          <CardContent className="py-12 text-center">
            <SearchIcon className="mx-auto mb-3 size-8 text-muted-foreground/50" />
            <p className="text-muted-foreground">
              Type a query above to search the catalog.
            </p>
          </CardContent>
        </Card>
      ) : total === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <SearchIcon className="mx-auto mb-3 size-8 text-muted-foreground/50" />
            <p className="text-muted-foreground">
              No results for <span className="font-medium">“{query}”</span>.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-10">
          {courses.length > 0 && (
            <section>
              <SectionHeader
                icon={<BookOpen className="size-4" />}
                title="Courses"
                count={courses.length}
              />
              <div className="space-y-3">
                {courses.map((c) => (
                  <Link key={c.id} to={`/courses/${c.slug}`} className="block">
                    <Card className="transition-colors hover:border-primary/50">
                      <CardContent className="flex gap-4 p-4">
                        <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                          {c.coverImageUrl ? (
                            <img
                              src={c.coverImageUrl}
                              alt=""
                              className="size-full object-cover"
                            />
                          ) : (
                            <BookOpen className="size-5 text-muted-foreground" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-medium">
                            <Highlight text={c.title} terms={terms} />
                          </h3>
                          <p className="line-clamp-2 text-sm text-muted-foreground">
                            <Highlight text={c.description} terms={terms} />
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            by {c.instructorName}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {lessons.length > 0 && (
            <section>
              <SectionHeader
                icon={<FileText className="size-4" />}
                title="Lessons"
                count={lessons.length}
              />
              <div className="space-y-3">
                {lessons.map((l) => (
                  <Link
                    key={l.id}
                    to={`/courses/${l.courseSlug}/lessons/${l.id}`}
                    className="block"
                  >
                    <Card className="transition-colors hover:border-primary/50">
                      <CardContent className="p-4">
                        <h3 className="font-medium">
                          <Highlight text={l.title} terms={terms} />
                        </h3>
                        {l.snippet && (
                          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                            <Highlight text={l.snippet} terms={terms} />
                          </p>
                        )}
                        <p className="mt-1 text-xs text-muted-foreground">
                          {l.courseTitle} · {l.moduleTitle}
                        </p>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {authors.length > 0 && (
            <section>
              <SectionHeader
                icon={<GraduationCap className="size-4" />}
                title="Authors"
                count={authors.length}
              />
              <div className="space-y-3">
                {authors.map((a) => (
                  <Link key={a.id} to={`/u/${a.id}`} className="block">
                    <Card className="transition-colors hover:border-primary/50">
                      <CardContent className="flex gap-4 p-4">
                        <UserAvatar
                          name={a.name}
                          avatarUrl={a.avatarUrl}
                          className="size-12 shrink-0"
                        />
                        <div className="min-w-0">
                          <h3 className="font-medium">
                            <Highlight text={a.name} terms={terms} />
                          </h3>
                          {a.bio && (
                            <p className="line-clamp-2 text-sm text-muted-foreground">
                              <Highlight text={a.bio} terms={terms} />
                            </p>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function SectionHeader({
  icon,
  title,
  count,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      {icon}
      <h2 className="text-lg font-semibold">{title}</h2>
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
        {count}
      </span>
    </div>
  );
}
