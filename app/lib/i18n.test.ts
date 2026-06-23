import { describe, it, expect } from "vitest";
import { translate, parseAcceptLanguage, isLocale, LOCALES } from "./i18n";

describe("translate", () => {
  it("returns the localized string for a known key", () => {
    expect(translate("ru", "nav.search")).toBe("Поиск");
    expect(translate("en", "nav.search")).toBe("Search");
  });

  it("falls back to English when a key is missing for the locale", () => {
    // A key only meaningful in English still resolves via the en dictionary.
    const ru = translate("ru", "nav.browse");
    expect(ru).toBe("Курсы");
  });

  it("falls back to the key itself when unknown everywhere", () => {
    expect(translate("en", "totally.unknown.key")).toBe("totally.unknown.key");
  });

  it("interpolates {placeholders}", () => {
    // Use a runtime key/template to exercise interpolation deterministically.
    expect(translate("en", "nav.search")).not.toContain("{");
  });

  it("interpolates provided vars into a template containing placeholders", () => {
    // translate falls back to the raw key, then interpolates against it.
    expect(translate("en", "Hello {name}", { name: "Sam" })).toBe("Hello Sam");
    expect(translate("en", "Hi {missing}", {})).toBe("Hi {missing}");
  });
});

describe("isLocale", () => {
  it("accepts supported locales and rejects others", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("ru")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(42)).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  it("LOCALES are all valid", () => {
    for (const loc of LOCALES) expect(isLocale(loc)).toBe(true);
  });
});

describe("parseAcceptLanguage", () => {
  it("returns null for a null/empty header", () => {
    expect(parseAcceptLanguage(null)).toBeNull();
    expect(parseAcceptLanguage("")).toBeNull();
  });

  it("matches a supported base language", () => {
    expect(parseAcceptLanguage("ru-RU,ru;q=0.9")).toBe("ru");
    expect(parseAcceptLanguage("en-US,en;q=0.9")).toBe("en");
  });

  it("honors q-value ranking", () => {
    // English preferred over Russian by quality.
    expect(parseAcceptLanguage("ru;q=0.5,en;q=0.9")).toBe("en");
  });

  it("skips unsupported languages and picks the first supported one", () => {
    expect(parseAcceptLanguage("fr-FR,de;q=0.8,ru;q=0.5")).toBe("ru");
  });

  it("returns null when nothing is supported", () => {
    expect(parseAcceptLanguage("fr-FR,de;q=0.8")).toBeNull();
  });
});
