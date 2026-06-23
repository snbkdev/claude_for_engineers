import { getLocale } from "./session";
import {
  DEFAULT_LOCALE,
  isLocale,
  parseAcceptLanguage,
  type Locale,
} from "./i18n";

// Resolve the request's locale: an explicit session choice wins, then the
// browser's Accept-Language, then the default. Server-only.
export async function resolveLocale(request: Request): Promise<Locale> {
  const stored = await getLocale(request);
  if (isLocale(stored)) return stored;

  const fromHeader = parseAcceptLanguage(
    request.headers.get("Accept-Language")
  );
  return fromHeader ?? DEFAULT_LOCALE;
}
