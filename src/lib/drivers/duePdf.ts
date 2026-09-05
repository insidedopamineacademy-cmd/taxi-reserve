import "server-only";

import { Prisma } from "@prisma/client";
import { subscriptionStatusLabel } from "./subscriptionStatus.ts";
import {
  formatBalanceEuro,
  prepareDriverBalanceReport,
  type DriverBalanceLine,
} from "./balanceReport.ts";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 44;
const CONTENT_BOTTOM = 54;
const TABLE_WIDTH = PAGE_WIDTH - MARGIN * 2;
const TABLE_HEADER_HEIGHT = 26;
const MINIMUM_ROW_HEIGHT = 30;
const TOTAL_GAP = 8;
const TOTAL_HEIGHT = 42;

const NAME_COLUMN_WIDTH = 217;
const LICENSE_COLUMN_WIDTH = 84;
const SUBSCRIPTION_COLUMN_WIDTH = 92;
const LICENSE_X = MARGIN + NAME_COLUMN_WIDTH;
const SUBSCRIPTION_X = LICENSE_X + LICENSE_COLUMN_WIDTH;
const AMOUNT_X = SUBSCRIPTION_X + SUBSCRIPTION_COLUMN_WIDTH;
const AMOUNT_RIGHT = MARGIN + TABLE_WIDTH;

const TEXT_COLOR = rgb(0.1, 0.12, 0.16);
const MUTED_COLOR = rgb(0.4, 0.42, 0.46);
const SUBTLE_COLOR = rgb(0.56, 0.57, 0.59);
const BORDER_COLOR = rgb(0.86, 0.86, 0.85);
const TABLE_HEADER_COLOR = rgb(0.96, 0.95, 0.93);
const ZEBRA_COLOR = rgb(0.988, 0.985, 0.975);
const TOTAL_COLOR = rgb(0.965, 0.95, 0.91);
const ACCENT_COLOR = rgb(0.73, 0.5, 0.08);

export const PENDING_COMMISSIONS_COLUMNS = [
  "Conductor",
  "Licencia",
  "Suscripción",
  "Pendiente",
] as const;

export type DueCommissionBalanceLine = DriverBalanceLine;

export type DueCommissionsReport = {
  totalDue: string;
  drivers: ReturnType<typeof prepareDriverBalanceReport>["drivers"];
};

export type DueCommissionsPdfInput = DueCommissionsReport & {
  generatedDate: string;
  subscriptionMonth: string;
};

/** Uses the same selection and canonical KPI total as the pending detail page. */
export function prepareDueCommissionsReport(
  lines: readonly DueCommissionBalanceLine[],
): DueCommissionsReport {
  const report = prepareDriverBalanceReport(lines, "due");
  return { totalDue: report.total, drivers: report.drivers };
}

function pdfSafeText(value: unknown) {
  return String(value ?? "")
    .replace(/[–—]/g, "-")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "?");
}

export const formatPendingEuro = formatBalanceEuro;

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const words = pdfSafeText(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const pieces = words.flatMap((word) => {
    if (font.widthOfTextAtSize(word, size) <= maxWidth) return [word];

    const chunks: string[] = [];
    let chunk = "";
    const hyphenatedPieces = word
      .split("-")
      .map((piece, index, all) => index < all.length - 1 ? `${piece}-` : piece)
      .filter(Boolean);

    for (const piece of hyphenatedPieces) {
      const candidate = `${chunk}${piece}`;
      if (chunk && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        chunks.push(chunk);
        chunk = "";
      }

      if (font.widthOfTextAtSize(piece, size) <= maxWidth) {
        chunk += piece;
      } else {
        for (const character of piece) {
          const characterCandidate = `${chunk}${character}`;
          if (
            chunk &&
            font.widthOfTextAtSize(characterCandidate, size) > maxWidth
          ) {
            chunks.push(chunk);
            chunk = character;
          } else {
            chunk = characterCandidate;
          }
        }
      }
    }
    if (chunk) chunks.push(chunk);
    return chunks;
  });

  const lines: string[] = [];
  let current = pieces[0];
  for (const piece of pieces.slice(1)) {
    const candidate = `${current} ${piece}`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = piece;
    }
  }
  lines.push(current);
  return lines;
}

type Fonts = {
  regular: PDFFont;
  bold: PDFFont;
};

type Writer = {
  doc: PDFDocument;
  page: PDFPage;
  fonts: Fonts;
  generatedDate: string;
  subscriptionMonth: string;
  moneySize: number;
  y: number;
};

function drawDocumentHeader(writer: Writer, continued: boolean) {
  const { page, fonts } = writer;
  page.drawText("Taxi Reserve", {
    x: MARGIN,
    y: PAGE_HEIGHT - 49,
    size: 10,
    font: fonts.bold,
    color: ACCENT_COLOR,
  });
  page.drawRectangle({
    x: MARGIN,
    y: PAGE_HEIGHT - 67,
    width: 34,
    height: 2,
    color: ACCENT_COLOR,
  });
  page.drawText("Comisiones pendientes", {
    x: MARGIN,
    y: PAGE_HEIGHT - (continued ? 88 : 98),
    size: continued ? 17 : 23,
    font: fonts.bold,
    color: TEXT_COLOR,
  });

  if (continued) {
    writer.y = PAGE_HEIGHT - 112;
    return;
  }

  page.drawText(`Generado: ${pdfSafeText(writer.generatedDate)}`, {
    x: MARGIN,
    y: PAGE_HEIGHT - 122,
    size: 9,
    font: fonts.regular,
    color: MUTED_COLOR,
  });
  page.drawText(`Mes de suscripción: ${pdfSafeText(writer.subscriptionMonth)}.`, {
    x: MARGIN, y: PAGE_HEIGHT - 139, size: 8, font: fonts.regular, color: MUTED_COLOR,
  });
  page.drawText("Estado de pago mensual independiente de las comisiones. El cargo ya está reflejado en el saldo.", {
    x: MARGIN, y: PAGE_HEIGHT - 151, size: 8, font: fonts.regular, color: MUTED_COLOR,
  });
  writer.y = PAGE_HEIGHT - 169;
}

function drawRightAlignedText(
  page: PDFPage,
  text: string,
  right: number,
  y: number,
  font: PDFFont,
  size: number,
  color = TEXT_COLOR,
) {
  page.drawText(text, {
    x: right - font.widthOfTextAtSize(text, size),
    y,
    size,
    font,
    color,
  });
}

function drawTableHeader(writer: Writer) {
  const bottom = writer.y - TABLE_HEADER_HEIGHT;
  writer.page.drawRectangle({
    x: MARGIN,
    y: bottom,
    width: TABLE_WIDTH,
    height: TABLE_HEADER_HEIGHT,
    color: TABLE_HEADER_COLOR,
  });
  const baseline = bottom + 9;
  writer.page.drawText(PENDING_COMMISSIONS_COLUMNS[0].toUpperCase(), {
    x: MARGIN + 8,
    y: baseline,
    size: 8,
    font: writer.fonts.bold,
    color: MUTED_COLOR,
  });
  writer.page.drawText(PENDING_COMMISSIONS_COLUMNS[1].toUpperCase(), {
    x: LICENSE_X + 8,
    y: baseline,
    size: 8,
    font: writer.fonts.bold,
    color: MUTED_COLOR,
  });
  drawRightAlignedText(
    writer.page,
    PENDING_COMMISSIONS_COLUMNS[2].toUpperCase(),
    AMOUNT_X - 8,
    baseline,
    writer.fonts.bold,
    8,
    MUTED_COLOR,
  );
  drawRightAlignedText(
    writer.page,
    PENDING_COMMISSIONS_COLUMNS[3].toUpperCase(),
    AMOUNT_RIGHT - 8,
    baseline,
    writer.fonts.bold,
    8,
    MUTED_COLOR,
  );
  writer.y = bottom;
}

function addTablePage(writer: Writer) {
  writer.page = writer.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  drawDocumentHeader(writer, true);
  drawTableHeader(writer);
}

function rowLayout(driver: DueCommissionsPdfInput["drivers"][number], fonts: Fonts) {
  const nameLines = wrapText(driver.name, fonts.regular, 9.5, NAME_COLUMN_WIDTH - 16);
  const licenseLines = wrapText(
    driver.licenseNumber,
    fonts.regular,
    9,
    LICENSE_COLUMN_WIDTH - 16,
  );
  const lineCount = Math.max(nameLines.length, licenseLines.length);
  return {
    nameLines,
    licenseLines,
    height: Math.max(MINIMUM_ROW_HEIGHT, lineCount * 11.5 + 10),
  };
}

function drawDriverRow(
  writer: Writer,
  driver: DueCommissionsPdfInput["drivers"][number],
  rowIndex: number,
  layout: ReturnType<typeof rowLayout>,
) {
  const bottom = writer.y - layout.height;
  if (rowIndex % 2 === 1) {
    writer.page.drawRectangle({
      x: MARGIN,
      y: bottom,
      width: TABLE_WIDTH,
      height: layout.height,
      color: ZEBRA_COLOR,
    });
  }

  const firstBaseline = writer.y - 15;
  layout.nameLines.forEach((line, index) => {
    writer.page.drawText(line, {
      x: MARGIN + 8,
      y: firstBaseline - index * 11.5,
      size: 9.5,
      font: writer.fonts.regular,
      color: TEXT_COLOR,
    });
  });
  layout.licenseLines.forEach((line, index) => {
    writer.page.drawText(line, {
      x: LICENSE_X + 8,
      y: firstBaseline - index * 11.5,
      size: 9,
      font: writer.fonts.regular,
      color: SUBTLE_COLOR,
    });
  });
  drawRightAlignedText(
    writer.page,
    formatPendingEuro(driver.subscription),
    AMOUNT_X - 8,
    writer.y - layout.height / 2 + 2,
    writer.fonts.regular,
    writer.moneySize,
    MUTED_COLOR,
  );
  drawRightAlignedText(
    writer.page,
    subscriptionStatusLabel(driver.subscriptionStatus, "es").toUpperCase(),
    AMOUNT_X - 8,
    writer.y - layout.height / 2 - 9,
    writer.fonts.regular,
    7,
    MUTED_COLOR,
  );
  drawRightAlignedText(
    writer.page,
    formatPendingEuro(driver.balance),
    AMOUNT_RIGHT - 8,
    writer.y - layout.height / 2 - 3.5,
    writer.fonts.bold,
    writer.moneySize,
  );
  writer.page.drawLine({
    start: { x: MARGIN, y: bottom },
    end: { x: AMOUNT_RIGHT, y: bottom },
    thickness: 0.55,
    color: BORDER_COLOR,
  });
  writer.y = bottom;
}

function drawTotal(writer: Writer, totalDue: string) {
  writer.y -= TOTAL_GAP;
  const bottom = writer.y - TOTAL_HEIGHT;
  writer.page.drawRectangle({
    x: MARGIN,
    y: bottom,
    width: TABLE_WIDTH,
    height: TOTAL_HEIGHT,
    color: TOTAL_COLOR,
  });
  writer.page.drawLine({
    start: { x: MARGIN, y: writer.y },
    end: { x: AMOUNT_RIGHT, y: writer.y },
    thickness: 1.1,
    color: ACCENT_COLOR,
  });
  const baseline = bottom + 15;
  const label = "Total pendiente";
  drawRightAlignedText(
    writer.page,
    label,
    AMOUNT_X - 12,
    baseline,
    writer.fonts.bold,
    10.5,
  );
  drawRightAlignedText(
    writer.page,
    formatPendingEuro(totalDue),
    AMOUNT_RIGHT - 8,
    baseline,
    writer.fonts.bold,
    Math.min(12, (AMOUNT_RIGHT - AMOUNT_X - 16) / writer.fonts.bold.widthOfTextAtSize(formatPendingEuro(totalDue), 1)),
  );
  writer.y = bottom;
}

function drawEmptyState(writer: Writer) {
  writer.page.drawLine({
    start: { x: MARGIN, y: writer.y },
    end: { x: AMOUNT_RIGHT, y: writer.y },
    thickness: 0.7,
    color: BORDER_COLOR,
  });
  writer.page.drawText("No hay comisiones pendientes.", {
    x: MARGIN,
    y: writer.y - 45,
    size: 13,
    font: writer.fonts.bold,
    color: TEXT_COLOR,
  });
}

function assertTotalReconciles(input: DueCommissionsPdfInput) {
  const displayedTotal = input.drivers.reduce(
    (total, driver) => total.plus(new Prisma.Decimal(driver.balance)),
    new Prisma.Decimal(0),
  );
  if (!displayedTotal.equals(new Prisma.Decimal(input.totalDue))) {
    throw new Error("Pending commissions PDF total does not reconcile with its rows");
  }
}

function drawFooters(doc: PDFDocument, fonts: Fonts) {
  const pages = doc.getPages();
  pages.forEach((page, index) => {
    page.drawLine({
      start: { x: MARGIN, y: 40 },
      end: { x: AMOUNT_RIGHT, y: 40 },
      thickness: 0.45,
      color: BORDER_COLOR,
    });
    const footer = `Taxi Reserve · Página ${index + 1} de ${pages.length}`;
    drawRightAlignedText(
      page,
      footer,
      AMOUNT_RIGHT,
      24,
      fonts.regular,
      7.5,
      MUTED_COLOR,
    );
  });
}

export async function buildDueCommissionsPdf(input: DueCommissionsPdfInput) {
  assertTotalReconciles(input);

  const doc = await PDFDocument.create();
  doc.setTitle("Comisiones pendientes");
  doc.setAuthor("Taxi Reserve");
  doc.setCreator("Taxi Reserve");
  doc.setSubject("Conductores con saldo de comisiones pendiente");

  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const writer: Writer = {
    doc,
    page: doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
    fonts,
    generatedDate: input.generatedDate,
    subscriptionMonth: input.subscriptionMonth,
    // One size for every money cell, fitted to the largest complete value.
    // Financial values stay on one line even at the Decimal(10,2) limit.
    moneySize: Math.min(10, ...input.drivers.flatMap((driver) => [
      (SUBSCRIPTION_COLUMN_WIDTH - 16) / fonts.regular.widthOfTextAtSize(formatPendingEuro(driver.subscription), 1),
      (AMOUNT_RIGHT - AMOUNT_X - 16) / fonts.bold.widthOfTextAtSize(formatPendingEuro(driver.balance), 1),
    ])),
    y: 0,
  };
  drawDocumentHeader(writer, false);

  if (input.drivers.length === 0) {
    drawEmptyState(writer);
  } else {
    drawTableHeader(writer);
    input.drivers.forEach((driver, index) => {
      const layout = rowLayout(driver, fonts);
      const isLastRow = index === input.drivers.length - 1;
      const requiredHeight =
        layout.height + (isLastRow ? TOTAL_GAP + TOTAL_HEIGHT : 0);
      if (writer.y - requiredHeight < CONTENT_BOTTOM) addTablePage(writer);
      drawDriverRow(writer, driver, index, layout);
    });
    drawTotal(writer, input.totalDue);
  }

  drawFooters(doc, fonts);
  return doc.save();
}
