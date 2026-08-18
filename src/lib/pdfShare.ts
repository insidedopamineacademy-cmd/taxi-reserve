/**
 * Client-safe helpers for sharing an authenticated PDF through the native Web
 * Share API. No server-only or Prisma imports so the deterministic logic can be
 * unit-tested in Node with injected dependencies.
 */

export const PDF_MIME = "application/pdf";

/**
 * Builds a filesystem-safe, human-dated PDF filename.
 * buildShareFilename("comisiones-pendientes", "18 Aug 2026")
 *   -> "comisiones-pendientes-18-Aug-2026.pdf"
 */
export function buildShareFilename(base: string, humanDate: string): string {
  const clean = (value: string) =>
    value
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^a-zA-Z0-9._-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");

  const stem = [clean(base), clean(humanDate)].filter(Boolean).join("-");
  return `${stem || "document"}.pdf`;
}

export type SharePdfOutcome = "shared" | "cancelled" | "unsupported" | "failed";

export type SharePdfDeps = {
  navigator: Pick<Navigator, "share" | "canShare"> | undefined;
  fetch: typeof fetch;
  FileCtor: typeof File;
};

/**
 * Fetches the protected PDF with the caller's session (same-origin cookies) and
 * hands it to the native share sheet as an application/pdf file.
 *
 * Returns a discriminated outcome rather than throwing, so the UI can:
 *  - "shared"      -> success
 *  - "cancelled"   -> user dismissed the share sheet (NOT an error)
 *  - "unsupported" -> browser can't share files -> caller falls back to open
 *  - "failed"      -> retrieval/share genuinely failed -> caller shows an error
 *
 * Never creates a public URL, token, or unauthenticated download path.
 */
export async function shareProtectedPdf(
  input: { url: string; filename: string; title: string },
  deps: SharePdfDeps,
): Promise<SharePdfOutcome> {
  const nav = deps.navigator;
  if (
    !nav ||
    typeof nav.share !== "function" ||
    typeof nav.canShare !== "function"
  ) {
    return "unsupported";
  }

  let response: Response;
  try {
    response = await deps.fetch(input.url, { credentials: "same-origin" });
  } catch {
    return "failed";
  }
  if (!response.ok) return "failed";

  let file: File;
  try {
    const blob = await response.blob();
    file = new deps.FileCtor([blob], input.filename, { type: PDF_MIME });
  } catch {
    return "failed";
  }

  if (!nav.canShare({ files: [file] })) return "unsupported";

  try {
    await nav.share({ files: [file], title: input.title });
    return "shared";
  } catch (error) {
    // A cancelled share sheet rejects with AbortError — treat as a normal action.
    if (error && (error as { name?: string }).name === "AbortError") {
      return "cancelled";
    }
    return "failed";
  }
}
