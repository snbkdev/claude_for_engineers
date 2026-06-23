import {
  Form,
  Link,
  useActionData,
  useNavigation,
  useSearchParams,
} from "react-router";
import { redirect, data } from "react-router";
import * as v from "valibot";
import type { Route } from "./+types/login";
import { login } from "~/services/authService";
import { setCurrentUserId, getCurrentUserId } from "~/lib/session";
import { parseFormData } from "~/lib/validation";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Card, CardContent } from "~/components/ui/card";
import { useT } from "~/lib/i18n.context";

const loginSchema = v.object({
  email: v.pipe(
    v.string(),
    v.trim(),
    v.toLowerCase(),
    v.minLength(1, "Email is required."),
    v.email("Please enter a valid email address.")
  ),
  password: v.pipe(v.string(), v.minLength(1, "Password is required.")),
});

export function meta() {
  return [
    { title: "Log In — Cadence" },
    { name: "description", content: "Log in to your Cadence account" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (currentUserId) {
    const url = new URL(request.url);
    const redirectTo = url.searchParams.get("redirectTo");
    const destination =
      redirectTo && redirectTo.startsWith("/") ? redirectTo : "/courses";
    throw redirect(destination);
  }
  return {};
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "");
  const parsed = parseFormData(formData, loginSchema);

  if (!parsed.success) {
    return data({ error: null, errors: parsed.errors, email }, { status: 400 });
  }

  const result = await login({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (!result.ok) {
    return data({ error: result.error, errors: null, email }, { status: 400 });
  }

  const url = new URL(request.url);
  const redirectTo = url.searchParams.get("redirectTo");
  const destination =
    redirectTo && redirectTo.startsWith("/") ? redirectTo : "/courses";

  const cookie = await setCurrentUserId(request, result.user.id);
  throw redirect(destination, { headers: { "Set-Cookie": cookie } });
}

export default function Login() {
  const t = useT();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirectTo");
  const signupHref = redirectTo
    ? `/signup?redirectTo=${encodeURIComponent(redirectTo)}`
    : "/signup";
  const justReset = searchParams.get("reset") === "1";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link to="/" className="text-2xl font-bold tracking-tight">
            Cadence
          </Link>
          <h1 className="mt-4 text-xl font-semibold">
            {t("auth.login.welcome")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("auth.login.subtitle")}
          </p>
        </div>

        <Card>
          <CardContent className="p-6">
            <Form method="post" className="space-y-4">
              {justReset && (
                <div className="rounded-md border border-green-500/40 bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-400">
                  {t("auth.login.resetDone")}
                </div>
              )}
              {actionData?.error && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                  {actionData.error}
                </div>
              )}

              <div>
                <label
                  htmlFor="email"
                  className="mb-1.5 block text-sm font-medium"
                >
                  {t("auth.email")}
                </label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="you@example.com"
                  defaultValue={actionData?.email ?? ""}
                  autoComplete="email"
                  aria-invalid={!!actionData?.errors?.email}
                />
                {actionData?.errors?.email && (
                  <p className="mt-1 text-sm text-destructive">
                    {actionData.errors.email}
                  </p>
                )}
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label
                    htmlFor="password"
                    className="block text-sm font-medium"
                  >
                    {t("auth.password")}
                  </label>
                  <Link
                    to="/forgot-password"
                    className="text-xs text-muted-foreground hover:text-primary hover:underline"
                  >
                    {t("auth.forgot")}
                  </Link>
                </div>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  placeholder="Your password"
                  autoComplete="current-password"
                  aria-invalid={!!actionData?.errors?.password}
                />
                {actionData?.errors?.password && (
                  <p className="mt-1 text-sm text-destructive">
                    {actionData.errors.password}
                  </p>
                )}
              </div>

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting
                  ? t("auth.login.submitting")
                  : t("auth.login.submit")}
              </Button>
            </Form>
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          {t("auth.login.noAccount")}{" "}
          <Link
            to={signupHref}
            className="font-medium text-primary hover:underline"
          >
            {t("auth.login.signUp")}
          </Link>
        </p>
      </div>
    </div>
  );
}
