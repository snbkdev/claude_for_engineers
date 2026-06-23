import { useFetcher, useLocation } from "react-router";
import { Globe } from "lucide-react";
import { LOCALES, LOCALE_LABELS } from "~/lib/i18n";
import { useI18n } from "~/lib/i18n.context";

// Compact language switcher: submits to /api/set-locale (persists in session,
// reloads with the new locale). Lives in the sidebar footer.
export function LanguageSwitcher() {
  const { locale, t } = useI18n();
  const fetcher = useFetcher();
  const location = useLocation();
  const redirectTo = location.pathname + location.search;

  function onChange(event: React.ChangeEvent<HTMLSelectElement>) {
    fetcher.submit(
      { locale: event.target.value, redirectTo },
      { method: "post", action: "/api/set-locale" }
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/70">
      <Globe className="size-4 shrink-0" aria-hidden="true" />
      <label htmlFor="locale-select" className="sr-only">
        {t("common.language")}
      </label>
      <select
        id="locale-select"
        value={locale}
        onChange={onChange}
        aria-label={t("common.language")}
        className="flex-1 cursor-pointer bg-transparent outline-none"
      >
        {LOCALES.map((loc) => (
          <option key={loc} value={loc} className="bg-sidebar text-foreground">
            {LOCALE_LABELS[loc]}
          </option>
        ))}
      </select>
    </div>
  );
}
