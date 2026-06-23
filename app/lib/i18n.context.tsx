import { createContext, useContext, useMemo } from "react";
import { DEFAULT_LOCALE, translate, type Locale } from "./i18n";

type TranslateFn = (
  key: string,
  vars?: Record<string, string | number>
) => string;

interface I18nValue {
  locale: Locale;
  t: TranslateFn;
}

const I18nContext = createContext<I18nValue>({
  locale: DEFAULT_LOCALE,
  t: (key) => translate(DEFAULT_LOCALE, key),
});

export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const value = useMemo<I18nValue>(
    () => ({
      locale,
      t: (key, vars) => translate(locale, key, vars),
    }),
    [locale]
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}

// Convenience hook returning just the translate function.
export function useT(): TranslateFn {
  return useContext(I18nContext).t;
}
