import { data } from "react-router";
import PDFDocument from "pdfkit";
import * as v from "valibot";
import type { Route } from "./+types/certificates.$code.pdf";
import { getCertificateByCode } from "~/services/certificateService";
import { parseParams } from "~/lib/validation";

const certificateParamsSchema = v.object({
  code: v.pipe(v.string(), v.minLength(1)),
});

type Certificate = NonNullable<ReturnType<typeof getCertificateByCode>>;

// Renders the certificate as an A4 landscape PDF using PDFKit's built-in
// Helvetica fonts (no font files needed). Collected into a Buffer in memory.
function renderPdf(cert: Certificate, verifyUrl: string): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 50 });
  const chunks: Buffer[] = [];

  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const { width, height } = doc.page;
  const issued = new Date(cert.issuedAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Outer + inner decorative border
  doc
    .lineWidth(3)
    .strokeColor("#d97706")
    .rect(25, 25, width - 50, height - 50)
    .stroke();
  doc
    .lineWidth(1)
    .strokeColor("#f59e0b")
    .rect(35, 35, width - 70, height - 70)
    .stroke();

  const contentWidth = width - 140;
  const left = 70;

  doc
    .fillColor("#b45309")
    .font("Helvetica-Bold")
    .fontSize(16)
    .text("CERTIFICATE OF COMPLETION", left, 110, {
      width: contentWidth,
      align: "center",
      characterSpacing: 4,
    });

  doc
    .fillColor("#6b7280")
    .font("Helvetica")
    .fontSize(13)
    .text("This certifies that", left, 175, {
      width: contentWidth,
      align: "center",
    });

  doc
    .fillColor("#111827")
    .font("Helvetica-Bold")
    .fontSize(40)
    .text(cert.recipientName, left, 205, {
      width: contentWidth,
      align: "center",
    });

  doc
    .fillColor("#6b7280")
    .font("Helvetica")
    .fontSize(13)
    .text("has successfully completed", left, 280, {
      width: contentWidth,
      align: "center",
    });

  doc
    .fillColor("#1f2937")
    .font("Helvetica-Bold")
    .fontSize(24)
    .text(cert.courseTitle, left, 310, {
      width: contentWidth,
      align: "center",
    });

  // Footer details
  const footerY = height - 150;
  doc
    .fillColor("#111827")
    .font("Helvetica-Bold")
    .fontSize(12)
    .text(issued, left, footerY, {
      width: contentWidth / 2 - 10,
      align: "center",
    });
  doc
    .fillColor("#9ca3af")
    .font("Helvetica")
    .fontSize(9)
    .text("DATE ISSUED", left, footerY + 18, {
      width: contentWidth / 2 - 10,
      align: "center",
    });

  if (cert.instructorName) {
    const rightX = left + contentWidth / 2 + 10;
    doc
      .fillColor("#111827")
      .font("Helvetica-Bold")
      .fontSize(12)
      .text(cert.instructorName, rightX, footerY, {
        width: contentWidth / 2 - 10,
        align: "center",
      });
    doc
      .fillColor("#9ca3af")
      .font("Helvetica")
      .fontSize(9)
      .text("INSTRUCTOR", rightX, footerY + 18, {
        width: contentWidth / 2 - 10,
        align: "center",
      });
  }

  doc
    .fillColor("#059669")
    .font("Helvetica")
    .fontSize(9)
    .text(`Verified · ${verifyUrl}`, left, height - 70, {
      width: contentWidth,
      align: "center",
    });

  doc.end();
  return done;
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const { code } = parseParams(params, certificateParamsSchema);

  const certificate = getCertificateByCode(code);
  if (!certificate) {
    throw data("Certificate not found", { status: 404 });
  }

  const verifyUrl = new URL(`/certificates/${code}`, request.url).toString();
  const pdf = await renderPdf(certificate, verifyUrl);

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="certificate-${code}.pdf"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
