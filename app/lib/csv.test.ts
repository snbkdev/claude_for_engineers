import { describe, it, expect } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("joins headers and rows with CRLF", () => {
    const csv = toCsv(
      ["A", "B"],
      [
        [1, 2],
        [3, 4],
      ]
    );
    expect(csv).toBe("A,B\r\n1,2\r\n3,4");
  });

  it("quotes fields containing commas, quotes, or newlines", () => {
    const csv = toCsv(
      ["Name", "Note"],
      [
        ["Doe, John", 'say "hi"'],
        ["multi\nline", "plain"],
      ]
    );
    expect(csv).toBe(
      'Name,Note\r\n"Doe, John","say ""hi"""\r\n"multi\nline",plain'
    );
  });

  it("renders null/undefined as empty cells", () => {
    expect(toCsv(["A", "B", "C"], [[null, undefined, 0]])).toBe("A,B,C\r\n,,0");
  });
});
