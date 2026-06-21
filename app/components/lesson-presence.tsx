import { useEffect, useState } from "react";
import { Eye } from "lucide-react";
import { cn } from "~/lib/utils";

// ─── Lesson Presence Indicator ───
// Shows the live "N watching now" count for a lesson over an SSE stream. The
// server counts every viewer; avatars are anonymized (seed-derived). The
// EventSource is closed on unmount.

interface Snapshot {
  count: number;
  avatarSeeds: string[];
}

const AVATAR = (seed: string) =>
  `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(seed)}`;

export function LessonPresence({
  lessonId,
  className,
}: {
  lessonId: number;
  className?: string;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>({
    count: 0,
    avatarSeeds: [],
  });

  useEffect(() => {
    const es = new EventSource(`/api/lessons/${lessonId}/presence`);
    es.addEventListener("presence", (e) => {
      try {
        setSnapshot(JSON.parse((e as MessageEvent).data));
      } catch {
        // Ignore malformed frames.
      }
    });
    return () => es.close();
  }, [lessonId]);

  // Until the stream delivers the first snapshot (which includes self) we render
  // nothing to avoid a flash of "0 watching".
  if (snapshot.count === 0) return null;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border bg-muted/40 px-3 py-1",
        className
      )}
      title={`${snapshot.count} ${snapshot.count === 1 ? "person is" : "people are"} watching this lesson now`}
    >
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-500 opacity-75" />
        <span className="relative inline-flex size-2 rounded-full bg-green-500" />
      </span>
      {snapshot.avatarSeeds.length > 0 && (
        <div className="flex -space-x-2">
          {snapshot.avatarSeeds.slice(0, 5).map((seed) => (
            <img
              key={seed}
              src={AVATAR(seed)}
              alt="viewer"
              className="size-6 rounded-full bg-background ring-2 ring-background"
            />
          ))}
        </div>
      )}
      <span className="flex items-center gap-1 text-sm font-medium">
        <Eye className="size-3.5" />
        {snapshot.count} watching
      </span>
    </div>
  );
}
