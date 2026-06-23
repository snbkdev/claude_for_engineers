import { redirect, data } from "react-router";
import type { Route } from "./+types/api.set-locale";
import { setLocale } from "~/lib/session";
import { isLocale } from "~/lib/i18n";

// Persist the chosen locale in the session, then return to the page the user
// was on. Posted by the language switcher.
export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const locale = String(formData.get("locale") ?? "");
  const redirectToRaw = String(formData.get("redirectTo") ?? "/");
  const redirectTo = redirectToRaw.startsWith("/") ? redirectToRaw : "/";

  if (!isLocale(locale)) {
    throw data("Unsupported locale.", { status: 400 });
  }

  const cookie = await setLocale(request, locale);
  return redirect(redirectTo, { headers: { "Set-Cookie": cookie } });
}
