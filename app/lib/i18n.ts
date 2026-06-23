// ─── i18n (pure, framework-agnostic) ───
// A tiny dictionary-based translator. `translate(locale, key, vars)` looks up a
// flat key, falls back to English then to the key itself, and interpolates
// {placeholders}. No dependencies — safe to import on server and client.

export type Locale = "en" | "ru";

export const LOCALES: Locale[] = ["en", "ru"];
export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  ru: "Русский",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as string[]).includes(value);
}

type Dict = Record<string, string>;

const en: Dict = {
  // nav
  "nav.browse": "Browse Courses",
  "nav.search": "Search",
  "nav.dashboard": "Dashboard",
  "nav.leaderboard": "Leaderboard",
  "nav.wishlist": "Wishlist",
  "nav.gifts": "Gifts",
  "nav.notes": "My Notes",
  "nav.myCourses": "My Courses",
  "nav.analytics": "Analytics",
  "nav.manageUsers": "Manage Users",
  "nav.manageCourses": "Manage Courses",
  "nav.moderation": "Moderation",
  "nav.categories": "Categories",
  "nav.promos": "Promo Codes",
  "nav.purchases": "Purchases",
  "nav.emails": "Email Outbox",
  "nav.team": "Team",
  "nav.recentCourses": "Recent Courses",
  // common
  "common.language": "Language",
  "common.darkMode": "Dark Mode",
  "common.lightMode": "Light Mode",
  "common.settings": "Settings",
  "common.signOut": "Sign out",
  "common.skipToContent": "Skip to main content",
  // auth — login
  "auth.login.welcome": "Welcome back",
  "auth.login.subtitle": "Log in to continue learning",
  "auth.email": "Email",
  "auth.password": "Password",
  "auth.forgot": "Forgot password?",
  "auth.login.submit": "Log In",
  "auth.login.submitting": "Logging in...",
  "auth.login.noAccount": "Don't have an account?",
  "auth.login.signUp": "Sign up",
  "auth.login.resetDone":
    "Your password has been reset. Log in with your new password.",
};

const ru: Dict = {
  // nav
  "nav.browse": "Курсы",
  "nav.search": "Поиск",
  "nav.dashboard": "Панель",
  "nav.leaderboard": "Лидеры",
  "nav.wishlist": "Избранное",
  "nav.gifts": "Подарки",
  "nav.notes": "Мои заметки",
  "nav.myCourses": "Мои курсы",
  "nav.analytics": "Аналитика",
  "nav.manageUsers": "Пользователи",
  "nav.manageCourses": "Управление курсами",
  "nav.moderation": "Модерация",
  "nav.categories": "Категории",
  "nav.promos": "Промокоды",
  "nav.purchases": "Покупки",
  "nav.emails": "Очередь писем",
  "nav.team": "Команда",
  "nav.recentCourses": "Недавние курсы",
  // common
  "common.language": "Язык",
  "common.darkMode": "Тёмная тема",
  "common.lightMode": "Светлая тема",
  "common.settings": "Настройки",
  "common.signOut": "Выйти",
  "common.skipToContent": "Перейти к основному содержимому",
  // auth — login
  "auth.login.welcome": "С возвращением",
  "auth.login.subtitle": "Войдите, чтобы продолжить обучение",
  "auth.email": "Эл. почта",
  "auth.password": "Пароль",
  "auth.forgot": "Забыли пароль?",
  "auth.login.submit": "Войти",
  "auth.login.submitting": "Входим...",
  "auth.login.noAccount": "Нет аккаунта?",
  "auth.login.signUp": "Зарегистрироваться",
  "auth.login.resetDone": "Пароль изменён. Войдите с новым паролем.",
};

const DICTIONARIES: Record<Locale, Dict> = { en, ru };

export type TranslationKey = keyof typeof en;

function interpolate(template: string, vars?: Record<string, string | number>) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) =>
    name in vars ? String(vars[name]) : `{${name}}`
  );
}

// Translate a key for a locale. Falls back: locale → English → the key itself.
export function translate(
  locale: Locale,
  key: string,
  vars?: Record<string, string | number>
): string {
  const dict = DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
  const template = dict[key] ?? DICTIONARIES[DEFAULT_LOCALE][key] ?? key;
  return interpolate(template, vars);
}

// Pick the best supported locale from an Accept-Language header, or null.
export function parseAcceptLanguage(header: string | null): Locale | null {
  if (!header) return null;

  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, q] = part.trim().split(";q=");
      return { tag: tag.trim().toLowerCase(), q: q ? parseFloat(q) : 1 };
    })
    .filter((entry) => entry.tag)
    .sort((a, b) => b.q - a.q);

  for (const { tag } of ranked) {
    const base = tag.split("-")[0];
    if (isLocale(base)) return base;
  }
  return null;
}
