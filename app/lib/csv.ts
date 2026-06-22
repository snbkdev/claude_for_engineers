// ─── CSV ───
// Minimal, dependency-free CSV serialization (RFC 4180-ish): fields containing
// a comma, quote, or newline are wrapped in double quotes with embedded quotes
// doubled. Rows are joined with CRLF for broad spreadsheet compatibility.

export type CsvValue = string | number | null | undefined;

function escapeCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv(headers: string[], rows: CsvValue[][]): string {
  return [headers, ...rows]
    .map((row) => row.map(escapeCell).join(","))
    .join("\r\n");
}
