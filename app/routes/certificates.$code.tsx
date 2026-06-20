import { Link, data, isRouteErrorResponse } from "react-router";
import * as v from "valibot";
import type { Route } from "./+types/certificates.$code";
import { getCertificateByCode } from "~/services/certificateService";
import { parseParams } from "~/lib/validation";
import { Button } from "~/components/ui/button";
import { Award, BadgeCheck, Download, AlertTriangle } from "lucide-react";

const certificateParamsSchema = v.object({
  code: v.pipe(v.string(), v.minLength(1)),
});

export function meta({ data }: Route.MetaArgs) {
  if (!data?.certificate) {
    return [{ title: "Certificate — Cadence" }];
  }
  return [
    {
      title: `${data.certificate.recipientName} — ${data.certificate.courseTitle} — Cadence`,
    },
    {
      name: "description",
      content: `Verified certificate of completion for ${data.certificate.courseTitle}.`,
    },
  ];
}

export async function loader({ params }: Route.LoaderArgs) {
  const { code } = parseParams(params, certificateParamsSchema);

  const certificate = getCertificateByCode(code);
  if (!certificate) {
    throw data("Certificate not found", { status: 404 });
  }

  return { certificate };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function CertificatePage({ loaderData }: Route.ComponentProps) {
  const { certificate } = loaderData;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/40 p-6">
      <div className="w-full max-w-3xl">
        {/* The certificate itself */}
        <div className="relative overflow-hidden rounded-xl border-4 border-double border-amber-500/60 bg-white p-10 text-center shadow-xl sm:p-14">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-amber-50 via-white to-amber-50" />
          <div className="relative">
            <Award className="mx-auto size-14 text-amber-500" />
            <p className="mt-4 text-sm font-semibold uppercase tracking-[0.3em] text-amber-600">
              Certificate of Completion
            </p>
            <p className="mt-8 text-sm text-muted-foreground">
              This certifies that
            </p>
            <h1 className="mt-2 text-4xl font-bold tracking-tight text-gray-900">
              {certificate.recipientName}
            </h1>
            <p className="mt-6 text-sm text-muted-foreground">
              has successfully completed
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-gray-800">
              {certificate.courseTitle}
            </h2>

            <div className="mt-10 flex flex-col items-center justify-center gap-4 text-sm text-gray-600 sm:flex-row sm:gap-10">
              <div>
                <p className="font-medium text-gray-900">
                  {formatDate(certificate.issuedAt)}
                </p>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Date issued
                </p>
              </div>
              {certificate.instructorName && (
                <div>
                  <p className="font-medium text-gray-900">
                    {certificate.instructorName}
                  </p>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Instructor
                  </p>
                </div>
              )}
            </div>

            <div className="mt-10 flex items-center justify-center gap-2 text-xs text-emerald-700">
              <BadgeCheck className="size-4" />
              <span>
                Verified · Cadence · code{" "}
                <span className="font-mono">{certificate.code}</span>
              </span>
            </div>
          </div>
        </div>

        {/* Actions (outside the printable certificate) */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Button asChild>
            <a href={`/certificates/${certificate.code}/pdf`}>
              <Download className="mr-2 size-4" />
              Download PDF
            </a>
          </Button>
          <Button variant="outline" asChild>
            <Link to={`/courses/${certificate.courseSlug}`}>View course</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = "Certificate not found";
      message =
        "We couldn't find a certificate with that code. Check the link and try again.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <Link to="/">
          <Button>Go Home</Button>
        </Link>
      </div>
    </div>
  );
}
