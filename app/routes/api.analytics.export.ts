import ExcelJS from "exceljs";
import { data } from "react-router";
import type { Route } from "./+types/api.analytics.export";
import { getCurrentUserId } from "~/lib/session";
import { getUserById } from "~/services/userService";
import {
  getCoursesByInstructor,
  getAllCourses,
} from "~/services/courseService";
import { resolveRange } from "~/lib/analytics";
import { UserRole } from "~/db/schema";
import { toCsv } from "~/lib/csv";
import {
  buildAnalyticsTable,
  buildAllAnalyticsTables,
  isAnalyticsDataset,
} from "~/lib/analytics-export.server";

// Exports analytics tables as CSV (one dataset) or XLSX (all three sheets),
// scoped to the caller's courses (admins → all, or a single instructor via
// ?instructorId=) and the active date range (?preset / ?from / ?to). GET only.
export async function loader({ request }: Route.LoaderArgs) {
  const userId = await getCurrentUserId(request);
  if (!userId) {
    throw data("You must be logged in.", { status: 401 });
  }
  const user = getUserById(userId);
  if (
    !user ||
    (user.role !== UserRole.Instructor && user.role !== UserRole.Admin)
  ) {
    throw data("Only instructors and admins can export analytics.", {
      status: 403,
    });
  }

  const searchParams = new URL(request.url).searchParams;
  const isAdmin = user.role === UserRole.Admin;

  // Scope: instructors get their own courses; admins get all, optionally
  // narrowed to one instructor (mirrors the admin analytics filter).
  let courseIds: number[];
  if (isAdmin) {
    const all = getAllCourses();
    const instructorIdParam = searchParams.get("instructorId");
    const selected = instructorIdParam ? Number(instructorIdParam) : null;
    courseIds = (
      selected ? all.filter((c) => c.instructorId === selected) : all
    ).map((c) => c.id);
  } else {
    courseIds = getCoursesByInstructor(userId).map((c) => c.id);
  }

  const range = resolveRange(searchParams);
  const opts = { courseIds, from: range.from, to: range.to };
  const today = new Date().toISOString().slice(0, 10);

  if (searchParams.get("format") === "xlsx") {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Cadence";
    workbook.created = new Date();
    for (const table of buildAllAnalyticsTables(opts)) {
      const ws = workbook.addWorksheet(table.sheetName);
      ws.columns = table.headers.map((header) => ({
        header,
        width: Math.max(16, header.length + 2),
      }));
      ws.addRows(table.rows);
      ws.getRow(1).font = { bold: true };
    }
    const buffer = await workbook.xlsx.writeBuffer();
    return new Response(buffer as unknown as BodyInit, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="cadence-analytics-${today}.xlsx"`,
      },
    });
  }

  // CSV — a single dataset (defaults to the per-course breakdown).
  const datasetParam = searchParams.get("dataset");
  const dataset = isAnalyticsDataset(datasetParam) ? datasetParam : "courses";
  const table = buildAnalyticsTable(dataset, opts);
  // Leading BOM so Excel reads UTF-8 correctly.
  const csv = "\uFEFF" + toCsv(table.headers, table.rows);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="cadence-${table.slug}-${today}.csv"`,
    },
  });
}
