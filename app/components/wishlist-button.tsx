import { useFetcher } from "react-router";
import { Heart } from "lucide-react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

// Toggles a course on the user's wishlist via the /api/wishlist resource route.
// `wishlisted` is the loader-provided state; while a toggle is in flight we show
// the optimistic flip, and the fetcher submission revalidates the page loader so
// `wishlisted` is correct again once it settles.
export function WishlistButton({
  courseId,
  wishlisted,
  variant = "button",
}: {
  courseId: number;
  wishlisted: boolean;
  variant?: "button" | "icon";
}) {
  const fetcher = useFetcher<{ wishlisted?: boolean; error?: string }>();
  const pending = fetcher.state !== "idle";
  const active = pending ? !wishlisted : wishlisted;
  const label = active ? "Remove from wishlist" : "Save for later";

  if (variant === "icon") {
    return (
      <fetcher.Form method="post" action="/api/wishlist">
        <input type="hidden" name="courseId" value={courseId} />
        <button
          type="submit"
          aria-label={label}
          title={label}
          disabled={pending}
          className={cn(
            "flex size-9 items-center justify-center rounded-full bg-background/80 text-muted-foreground shadow-sm ring-1 ring-inset ring-border backdrop-blur transition-colors hover:text-rose-500",
            active && "text-rose-500"
          )}
        >
          <Heart className={cn("size-4", active && "fill-current")} />
        </button>
      </fetcher.Form>
    );
  }

  return (
    <fetcher.Form method="post" action="/api/wishlist">
      <input type="hidden" name="courseId" value={courseId} />
      <Button
        type="submit"
        variant="outline"
        className="w-full"
        disabled={pending}
      >
        <Heart
          className={cn("mr-2 size-4", active && "fill-current text-rose-500")}
        />
        {active ? "Saved — remove" : "Save for later"}
      </Button>
    </fetcher.Form>
  );
}
