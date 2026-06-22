import { useSearchParams } from "react-router";
import { Button } from "~/components/ui/button";
import { Download } from "lucide-react";

// Export controls for the analytics pages. Links carry the page's current range
// (and any instructor filter) through to the /api/analytics/export resource
// route. XLSX bundles all three tables as sheets; CSV exports one table each.
export function AnalyticsExport() {
  const [searchParams] = useSearchParams();

  function href(format: "csv" | "xlsx", dataset?: string) {
    const params = new URLSearchParams(searchParams);
    params.set("format", format);
    if (dataset) params.set("dataset", dataset);
    else params.delete("dataset");
    return `/api/analytics/export?${params.toString()}`;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground">Export:</span>
      <Button asChild variant="outline" size="sm">
        <a href={href("xlsx")} download>
          <Download className="mr-1.5 size-3.5" />
          XLSX (all)
        </a>
      </Button>
      <Button asChild variant="outline" size="sm">
        <a href={href("csv", "courses")} download>
          Courses CSV
        </a>
      </Button>
      <Button asChild variant="outline" size="sm">
        <a href={href("csv", "timeseries")} download>
          Over-time CSV
        </a>
      </Button>
      <Button asChild variant="outline" size="sm">
        <a href={href("csv", "countries")} download>
          Countries CSV
        </a>
      </Button>
    </div>
  );
}
