import { Form, Link, useActionData, useNavigation } from "react-router";
import { data, redirect } from "react-router";
import * as v from "valibot";
import type { Route } from "./+types/reset-password";
import { getValidResetToken, resetPassword } from "~/services/authService";
import { parseFormData } from "~/lib/validation";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Card, CardContent } from "~/components/ui/card";
import { AlertTriangle } from "lucide-react";

const schema = v.pipe(
  v.object({
    token: v.pipe(v.string(), v.minLength(1, "Missing reset token.")),
    password: v.pipe(
      v.string(),
      v.minLength(8, "Password must be at least 8 characters.")
    ),
    confirmPassword: v.string(),
  }),
  v.forward(
    v.partialCheck(
      [["password"], ["confirmPassword"]],
      (input) => input.password === input.confirmPassword,
      "Passwords do not match."
    ),
    ["confirmPassword"]
  )
);

export function meta() {
  return [{ title: "Set a New Password — Cadence" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const valid = token.length > 0 && !!getValidResetToken(token);
  return { token, valid };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const parsed = parseFormData(formData, schema);

  if (!parsed.success) {
    return data({ errors: parsed.errors }, { status: 400 });
  }

  const result = await resetPassword({
    token: parsed.data.token,
    password: parsed.data.password,
  });

  if (!result.ok) {
    return data({ errors: { password: result.error } }, { status: 400 });
  }

  throw redirect("/login?reset=1");
}

export default function ResetPassword({ loaderData }: Route.ComponentProps) {
  const { token, valid } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const errors = actionData?.errors as Record<string, string> | undefined;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link to="/" className="text-2xl font-bold tracking-tight">
            Cadence
          </Link>
          <h1 className="mt-4 text-xl font-semibold">Set a new password</h1>
        </div>

        <Card>
          <CardContent className="p-6">
            {!valid ? (
              <div className="text-center">
                <AlertTriangle className="mx-auto mb-3 size-8 text-muted-foreground" />
                <p className="mb-4 text-sm text-muted-foreground">
                  This reset link is invalid or has expired.
                </p>
                <Link to="/forgot-password">
                  <Button variant="outline">Request a new link</Button>
                </Link>
              </div>
            ) : (
              <Form method="post" className="space-y-4">
                <input type="hidden" name="token" value={token} />

                <div>
                  <label
                    htmlFor="password"
                    className="mb-1.5 block text-sm font-medium"
                  >
                    New password
                  </label>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    placeholder="At least 8 characters"
                    autoComplete="new-password"
                    aria-invalid={!!errors?.password}
                  />
                  {errors?.password && (
                    <p className="mt-1 text-sm text-destructive">
                      {errors.password}
                    </p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="confirmPassword"
                    className="mb-1.5 block text-sm font-medium"
                  >
                    Confirm new password
                  </label>
                  <Input
                    id="confirmPassword"
                    name="confirmPassword"
                    type="password"
                    placeholder="Re-enter your password"
                    autoComplete="new-password"
                    aria-invalid={!!errors?.confirmPassword}
                  />
                  {errors?.confirmPassword && (
                    <p className="mt-1 text-sm text-destructive">
                      {errors.confirmPassword}
                    </p>
                  )}
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Saving..." : "Reset password"}
                </Button>
              </Form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
