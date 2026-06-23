import { Form, Link, useActionData, useNavigation } from "react-router";
import { data } from "react-router";
import * as v from "valibot";
import type { Route } from "./+types/forgot-password";
import { requestPasswordReset } from "~/services/authService";
import { parseFormData } from "~/lib/validation";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Card, CardContent } from "~/components/ui/card";
import { MailCheck } from "lucide-react";

const schema = v.object({
  email: v.pipe(
    v.string(),
    v.trim(),
    v.toLowerCase(),
    v.minLength(1, "Email is required."),
    v.email("Please enter a valid email address.")
  ),
});

export function meta() {
  return [
    { title: "Forgot Password — Cadence" },
    { name: "description", content: "Reset your Cadence password" },
  ];
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const parsed = parseFormData(formData, schema);

  if (!parsed.success) {
    return data({ errors: parsed.errors, sent: false }, { status: 400 });
  }

  // Always report success so the response can't reveal whether the email exists.
  await requestPasswordReset(parsed.data.email);
  return { errors: null, sent: true };
}

export default function ForgotPassword() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link to="/" className="text-2xl font-bold tracking-tight">
            Cadence
          </Link>
          <h1 className="mt-4 text-xl font-semibold">Reset your password</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            We'll email you a link to set a new one
          </p>
        </div>

        <Card>
          <CardContent className="p-6">
            {actionData?.sent ? (
              <div className="text-center">
                <MailCheck className="mx-auto mb-3 size-8 text-primary" />
                <p className="text-sm text-muted-foreground">
                  If an account exists for that email, we've sent a password
                  reset link. Check your inbox.
                </p>
              </div>
            ) : (
              <Form method="post" className="space-y-4">
                <div>
                  <label
                    htmlFor="email"
                    className="mb-1.5 block text-sm font-medium"
                  >
                    Email
                  </label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="you@example.com"
                    autoComplete="email"
                    aria-invalid={!!actionData?.errors?.email}
                  />
                  {actionData?.errors?.email && (
                    <p className="mt-1 text-sm text-destructive">
                      {actionData.errors.email}
                    </p>
                  )}
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Sending..." : "Send reset link"}
                </Button>
              </Form>
            )}
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Remembered it?{" "}
          <Link
            to="/login"
            className="font-medium text-primary hover:underline"
          >
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
