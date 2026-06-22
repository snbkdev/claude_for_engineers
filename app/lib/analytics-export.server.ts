import {
  getRevenueByCourse,
  getRevenueTimeSeries,
  getRevenueByCountry,
} from "~/services/analyticsService";

// ─── Analytics export tables ───
// Turns the analytics service data into flat, spreadsheet-ready tables (one per
// dataset) shared by the CSV and XLSX exporters. Revenue (stored in cents) is
// emitted as a USD number so spreadsheets can sum/format it natively.

export type AnalyticsDataset = "courses" | "timeseries" | "countries";

export const ANALYTICS_DATASETS: AnalyticsDataset[] = [
  "courses",
  "timeseries",
  "countries",
];

export function isAnalyticsDataset(value: unknown): value is AnalyticsDataset {
  return ANALYTICS_DATASETS.includes(value as AnalyticsDataset);
}

export interface AnalyticsTable {
  dataset: AnalyticsDataset;
  sheetName: string;
  slug: string;
  headers: string[];
  rows: (string | number)[][];
}

type RangeOpts = {
  courseIds: number[];
  from?: string | null;
  to?: string | null;
};

function usd(cents: number): number {
  return Math.round(cents) / 100;
}

export function buildAnalyticsTable(
  dataset: AnalyticsDataset,
  opts: RangeOpts
): AnalyticsTable {
  switch (dataset) {
    case "courses": {
      const rows = getRevenueByCourse(opts);
      return {
        dataset,
        sheetName: "Courses",
        slug: "courses",
        headers: ["Course", "Revenue (USD)", "Sales", "Seats"],
        rows: rows.map((r) => [
          r.title,
          usd(r.revenue),
          r.transactions,
          r.seats,
        ]),
      };
    }
    case "timeseries": {
      const rows = getRevenueTimeSeries(opts);
      return {
        dataset,
        sheetName: "Revenue over time",
        slug: "revenue-over-time",
        headers: ["Period", "Revenue (USD)", "Sales"],
        rows: rows.map((r) => [r.label, usd(r.revenue), r.transactions]),
      };
    }
    case "countries": {
      const rows = getRevenueByCountry(opts);
      return {
        dataset,
        sheetName: "Revenue by country",
        slug: "revenue-by-country",
        headers: ["Country", "Revenue (USD)", "Sales"],
        rows: rows.map((r) => [r.country, usd(r.revenue), r.transactions]),
      };
    }
  }
}

export function buildAllAnalyticsTables(opts: RangeOpts): AnalyticsTable[] {
  return ANALYTICS_DATASETS.map((dataset) =>
    buildAnalyticsTable(dataset, opts)
  );
}
