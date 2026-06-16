import { useFetcher } from "react-router";
import { Bookmark } from "lucide-react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

// Toggles a bookmark by posting `intent=toggle-bookmark` to the current route's
// action. The page loader revalidates afterwards, so we only need an optimistic
// flip while the request is in flight.
export function BookmarkButton({
  isBookmarked,
  size = "default",
}: {
  isBookmarked: boolean;
  size?: "default" | "sm";
}) {
  const fetcher = useFetcher();
  const pending = fetcher.state !== "idle";
  const active = pending ? !isBookmarked : isBookmarked;

  return (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value="toggle-bookmark" />
      <Button
        type="submit"
        variant={active ? "secondary" : "outline"}
        size={size}
        disabled={pending}
        aria-pressed={active}
      >
        <Bookmark className={cn("mr-1.5 size-4", active && "fill-current")} />
        {active ? "Saved" : "Save"}
      </Button>
    </fetcher.Form>
  );
}
