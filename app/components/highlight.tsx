// Wraps occurrences of any search term in <mark>. Terms are expected lowercase
// (as produced by searchService.parseQuery); matching is case-insensitive.
// Pure/deterministic — safe to render on the server.

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function Highlight({ text, terms }: { text: string; terms: string[] }) {
  const escaped = terms.map(escapeRegExp).filter(Boolean);
  if (!text || escaped.length === 0) return <>{text}</>;

  const re = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = text.split(re);
  const termSet = new Set(terms);

  return (
    <>
      {parts.map((part, i) =>
        termSet.has(part.toLowerCase()) ? (
          <mark
            key={i}
            className="rounded bg-yellow-200 px-0.5 text-inherit dark:bg-yellow-500/30"
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}
