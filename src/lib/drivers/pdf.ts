import "server-only";

import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 46;
const FOOTER_HEIGHT = 28;
const TEXT_COLOR = rgb(0.12, 0.15, 0.22);
const MUTED_COLOR = rgb(0.38, 0.42, 0.5);
const BORDER_COLOR = rgb(0.84, 0.86, 0.9);
const ACCENT_COLOR = rgb(0.92, 0.67, 0.05);

function pdfSafeText(value: unknown) {
  return String(value ?? "")
    .replace(/→/g, "->")
    .replace(/[–—]/g, "-")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "?");
}

function formatPdfMoney(value: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return `EUR ${pdfSafeText(value)}`;
  return `EUR ${amount.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const words = pdfSafeText(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const wrappedWords = words.flatMap((word) => {
    if (font.widthOfTextAtSize(word, size) <= maxWidth) return [word];

    const chunks: string[] = [];
    let chunk = "";
    for (const character of word) {
      const candidate = `${chunk}${character}`;
      if (chunk && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        chunks.push(chunk);
        chunk = character;
      } else {
        chunk = candidate;
      }
    }
    if (chunk) chunks.push(chunk);
    return chunks;
  });
  const lines: string[] = [];
  let current = wrappedWords[0];

  for (const word of wrappedWords.slice(1)) {
    const candidate = `${current} ${word}`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  return lines;
}

type ReportWriter = {
  doc: PDFDocument;
  regular: PDFFont;
  bold: PDFFont;
  page: PDFPage;
  y: number;
  reportTitle: string;
  continuationContext?: string;
};

async function createReport(reportTitle: string): Promise<ReportWriter> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const writer = {
    doc,
    regular,
    bold,
    page: doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
    y: PAGE_HEIGHT - MARGIN,
    reportTitle,
  };
  drawPageHeader(writer, false);
  return writer;
}

function drawPageHeader(writer: ReportWriter, continued: boolean) {
  writer.page.drawText("TAXI RESERVE", {
    x: MARGIN,
    y: writer.y,
    size: 9,
    font: writer.bold,
    color: ACCENT_COLOR,
  });
  writer.y -= 24;
  writer.page.drawText(
    pdfSafeText(continued ? `${writer.reportTitle} - continued` : writer.reportTitle),
    {
      x: MARGIN,
      y: writer.y,
      size: continued ? 16 : 22,
      font: writer.bold,
      color: TEXT_COLOR,
    },
  );
  writer.y -= continued ? 28 : 36;
}

function addPage(writer: ReportWriter) {
  writer.page = writer.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  writer.y = PAGE_HEIGHT - MARGIN;
  drawPageHeader(writer, true);
  if (writer.continuationContext) {
    const lines = wrapText(
      `Driver: ${writer.continuationContext}`,
      writer.bold,
      9,
      PAGE_WIDTH - MARGIN * 2,
    );
    for (const line of lines) {
      writer.page.drawText(line, {
        x: MARGIN,
        y: writer.y,
        size: 9,
        font: writer.bold,
        color: MUTED_COLOR,
      });
      writer.y -= 13;
    }
    writer.y -= 5;
  }
}

function ensureSpace(writer: ReportWriter, height: number) {
  if (writer.y - height < MARGIN + FOOTER_HEIGHT) addPage(writer);
}

function drawWrappedText(
  writer: ReportWriter,
  text: string,
  options: {
    x?: number;
    size?: number;
    lineHeight?: number;
    maxWidth?: number;
    font?: PDFFont;
    color?: ReturnType<typeof rgb>;
  } = {},
) {
  const size = options.size ?? 10;
  const lineHeight = options.lineHeight ?? size + 4;
  const font = options.font ?? writer.regular;
  const x = options.x ?? MARGIN;
  const maxWidth = options.maxWidth ?? PAGE_WIDTH - MARGIN - x;
  const lines = wrapText(text, font, size, maxWidth);
  ensureSpace(writer, lines.length * lineHeight);
  for (const line of lines) {
    writer.page.drawText(line, {
      x,
      y: writer.y,
      size,
      font,
      color: options.color ?? TEXT_COLOR,
    });
    writer.y -= lineHeight;
  }
}

function drawMetadata(writer: ReportWriter, label: string, value: string) {
  const valueX = MARGIN + 86;
  const lines = wrapText(
    value,
    writer.regular,
    9,
    PAGE_WIDTH - MARGIN - valueX,
  );
  const height = Math.max(17, lines.length * 13 + 4);
  ensureSpace(writer, height);
  writer.page.drawText(pdfSafeText(`${label}:`), {
    x: MARGIN,
    y: writer.y,
    size: 9,
    font: writer.bold,
    color: MUTED_COLOR,
  });
  lines.forEach((line, index) => {
    writer.page.drawText(line, {
      x: valueX,
      y: writer.y - index * 13,
      size: 9,
      font: writer.regular,
      color: TEXT_COLOR,
    });
  });
  writer.y -= height;
}

function drawMetrics(
  writer: ReportWriter,
  metrics: Array<{ label: string; value: string }>,
) {
  const gap = 8;
  const width = (PAGE_WIDTH - MARGIN * 2 - gap * (metrics.length - 1)) / metrics.length;
  const height = 58;
  ensureSpace(writer, height + 18);
  const top = writer.y;

  metrics.forEach((metric, index) => {
    const x = MARGIN + index * (width + gap);
    writer.page.drawRectangle({
      x,
      y: top - height,
      width,
      height,
      borderWidth: 0.8,
      borderColor: index === metrics.length - 1 ? ACCENT_COLOR : BORDER_COLOR,
      color: index === metrics.length - 1 ? rgb(1, 0.98, 0.9) : rgb(0.97, 0.98, 0.99),
    });
    writer.page.drawText(pdfSafeText(metric.label), {
      x: x + 10,
      y: top - 20,
      size: 8,
      font: writer.regular,
      color: MUTED_COLOR,
    });
    writer.page.drawText(pdfSafeText(metric.value), {
      x: x + 10,
      y: top - 42,
      size: 12,
      font: writer.bold,
      color: TEXT_COLOR,
    });
  });

  writer.y = top - height - 18;
}

function drawSectionTitle(writer: ReportWriter, title: string) {
  ensureSpace(writer, 32);
  writer.page.drawText(pdfSafeText(title), {
    x: MARGIN,
    y: writer.y,
    size: 13,
    font: writer.bold,
    color: TEXT_COLOR,
  });
  writer.y -= 8;
  writer.page.drawLine({
    start: { x: MARGIN, y: writer.y },
    end: { x: PAGE_WIDTH - MARGIN, y: writer.y },
    thickness: 0.8,
    color: BORDER_COLOR,
  });
  writer.y -= 20;
}

function entryHeaderLayout(writer: ReportWriter, left: string, right: string) {
  const safeRight = pdfSafeText(right);
  const rightWidth = writer.bold.widthOfTextAtSize(safeRight, 9);
  const leftLines = wrapText(
    left,
    writer.bold,
    9,
    PAGE_WIDTH - MARGIN * 2 - rightWidth - 18,
  );
  return {
    safeRight,
    rightWidth,
    leftLines,
    height: Math.max(17, leftLines.length * 12 + 5),
  };
}

function drawEntryHeader(writer: ReportWriter, left: string, right: string) {
  const layout = entryHeaderLayout(writer, left, right);
  ensureSpace(writer, layout.height);
  layout.leftLines.forEach((line, index) => {
    writer.page.drawText(line, {
      x: MARGIN,
      y: writer.y - index * 12,
      size: 9,
      font: writer.bold,
      color: TEXT_COLOR,
    });
  });
  writer.page.drawText(layout.safeRight, {
    x: PAGE_WIDTH - MARGIN - layout.rightWidth,
    y: writer.y,
    size: 9,
    font: writer.bold,
    color: TEXT_COLOR,
  });
  writer.y -= layout.height;
}

function drawEntryDivider(writer: ReportWriter) {
  writer.y -= 5;
  ensureSpace(writer, 12);
  writer.page.drawLine({
    start: { x: MARGIN, y: writer.y },
    end: { x: PAGE_WIDTH - MARGIN, y: writer.y },
    thickness: 0.5,
    color: BORDER_COLOR,
  });
  writer.y -= 13;
}

async function finishReport(writer: ReportWriter) {
  const pages = writer.doc.getPages();
  pages.forEach((page, index) => {
    const footer = `Generated by Taxi Reserve | Page ${index + 1} of ${pages.length}`;
    page.drawText(footer, {
      x: MARGIN,
      y: 24,
      size: 7,
      font: writer.regular,
      color: MUTED_COLOR,
    });
  });
  return writer.doc.save();
}

type PdfCommissionHistoryEntry = {
  date: string;
  pickupText: string | null;
  dropoffText: string | null;
  amount: string;
  source?: string;
};

type PdfPaymentHistoryEntry = {
  date: string;
  method: string;
  amount: string;
};

function commissionEntryHeight(
  writer: ReportWriter,
  commission: PdfCommissionHistoryEntry,
) {
  const amount = formatPdfMoney(commission.amount);
  const pickup = `Pickup: ${commission.pickupText || "Not set"}`;
  const dropoff = `Drop-off: ${commission.dropoffText || "Not set"}`;
  const source = commission.source ? `Source: ${commission.source}` : null;

  return (
    entryHeaderLayout(writer, commission.date, amount).height +
    wrapText(pickup, writer.regular, 9, PAGE_WIDTH - MARGIN * 2).length * 13 +
    wrapText(dropoff, writer.regular, 9, PAGE_WIDTH - MARGIN * 2).length * 13 +
    (source
      ? wrapText(source, writer.regular, 9, PAGE_WIDTH - MARGIN * 2).length * 13
      : 0) +
    18
  );
}

function drawCommissionHistory(
  writer: ReportWriter,
  commissions: PdfCommissionHistoryEntry[],
) {
  ensureSpace(
    writer,
    32 + (commissions[0] ? commissionEntryHeight(writer, commissions[0]) : 14),
  );
  drawSectionTitle(writer, "Commission History");

  if (commissions.length === 0) {
    drawWrappedText(writer, "No commission entries.", { color: MUTED_COLOR });
    return;
  }

  for (const commission of commissions) {
    const amount = formatPdfMoney(commission.amount);
    const pickup = `Pickup: ${commission.pickupText || "Not set"}`;
    const dropoff = `Drop-off: ${commission.dropoffText || "Not set"}`;
    ensureSpace(writer, commissionEntryHeight(writer, commission));
    drawEntryHeader(writer, commission.date, amount);
    if (commission.source) {
      drawWrappedText(writer, `Source: ${commission.source}`, {
        size: 9,
        color: MUTED_COLOR,
      });
    }
    drawWrappedText(writer, pickup, {
      size: 9,
      color: MUTED_COLOR,
    });
    drawWrappedText(writer, dropoff, {
      size: 9,
      color: MUTED_COLOR,
    });
    drawEntryDivider(writer);
  }
}

function paymentEntryHeight(
  writer: ReportWriter,
  payment: PdfPaymentHistoryEntry,
) {
  const amount = formatPdfMoney(payment.amount);
  const method = `Method: ${payment.method}`;
  return (
    entryHeaderLayout(writer, payment.date, amount).height +
    wrapText(method, writer.regular, 9, PAGE_WIDTH - MARGIN * 2).length * 13 +
    18
  );
}

function drawPaymentHistory(
  writer: ReportWriter,
  payments: PdfPaymentHistoryEntry[],
) {
  ensureSpace(
    writer,
    32 + (payments[0] ? paymentEntryHeight(writer, payments[0]) : 14),
  );
  drawSectionTitle(writer, "Payment History");

  if (payments.length === 0) {
    drawWrappedText(writer, "No payments recorded.", { color: MUTED_COLOR });
    return;
  }

  for (const payment of payments) {
    const amount = formatPdfMoney(payment.amount);
    const method = `Method: ${payment.method}`;
    ensureSpace(writer, paymentEntryHeight(writer, payment));
    drawEntryHeader(writer, payment.date, amount);
    drawWrappedText(writer, method, {
      size: 9,
      color: MUTED_COLOR,
    });
    drawEntryDivider(writer);
  }
}

export type DriverLedgerPdfInput = {
  driverName: string;
  licenseNumber: string;
  generatedDate: string;
  totalCommissions: string;
  totalPayments: string;
  balance: string;
  commissions: PdfCommissionHistoryEntry[];
  payments: PdfPaymentHistoryEntry[];
};

export async function buildDriverLedgerPdf(input: DriverLedgerPdfInput) {
  const writer = await createReport("Driver Ledger");
  drawMetadata(writer, "Driver", input.driverName);
  drawMetadata(writer, "License", input.licenseNumber);
  drawMetadata(writer, "Generated", input.generatedDate);
  writer.y -= 8;
  drawMetrics(writer, [
    { label: "Total commissions", value: formatPdfMoney(input.totalCommissions) },
    { label: "Total payments", value: formatPdfMoney(input.totalPayments) },
    { label: "Current balance", value: formatPdfMoney(input.balance) },
  ]);

  drawCommissionHistory(writer, input.commissions);

  writer.y -= 10;
  drawPaymentHistory(writer, input.payments);

  return finishReport(writer);
}

export type FullDriverLedgerPdfInput = {
  generatedAt: string;
  drivers: Array<{
    name: string;
    licenseNumber: string;
    status: "ACTIVE" | "INACTIVE";
    totalCommissions: string;
    totalPayments: string;
    balance: string;
    commissions: PdfCommissionHistoryEntry[];
    payments: PdfPaymentHistoryEntry[];
  }>;
};

export async function buildFullDriverLedgerPdf(input: FullDriverLedgerPdfInput) {
  const writer = await createReport("Full Driver Commission Ledger");
  drawMetadata(writer, "Generated", input.generatedAt);
  drawMetadata(writer, "Drivers", String(input.drivers.length));
  writer.y -= 10;

  if (input.drivers.length === 0) {
    drawWrappedText(writer, "No drivers have been created yet.", {
      color: MUTED_COLOR,
    });
    return finishReport(writer);
  }

  input.drivers.forEach((driver, index) => {
    if (index > 0) {
      writer.continuationContext = undefined;
      addPage(writer);
    }
    writer.continuationContext = driver.name;
    ensureSpace(writer, 180);

    writer.page.drawText(`DRIVER ${index + 1} OF ${input.drivers.length}`, {
      x: MARGIN,
      y: writer.y,
      size: 8,
      font: writer.bold,
      color: ACCENT_COLOR,
    });
    writer.y -= 18;
    drawWrappedText(writer, driver.name, {
      size: 17,
      lineHeight: 21,
      font: writer.bold,
      color: TEXT_COLOR,
    });
    writer.y -= 4;
    drawMetadata(writer, "License", driver.licenseNumber);
    drawMetadata(writer, "Status", driver.status);
    writer.y -= 6;
    drawMetrics(writer, [
      { label: "Total commissions", value: formatPdfMoney(driver.totalCommissions) },
      { label: "Total payments", value: formatPdfMoney(driver.totalPayments) },
      { label: "Current balance", value: formatPdfMoney(driver.balance) },
    ]);

    drawCommissionHistory(writer, driver.commissions);
    writer.y -= 10;
    drawPaymentHistory(writer, driver.payments);
  });

  return finishReport(writer);
}

export type DueCommissionsPdfInput = {
  generatedDate: string;
  totalDue: string;
  drivers: Array<{
    name: string;
    licenseNumber: string;
    totalCommissions: string;
    totalPayments: string;
    balance: string;
  }>;
};

export async function buildDueCommissionsPdf(input: DueCommissionsPdfInput) {
  const writer = await createReport("Due Commissions");
  drawMetadata(writer, "Generated", input.generatedDate);
  drawMetadata(writer, "Drivers due", String(input.drivers.length));
  writer.y -= 8;
  drawMetrics(writer, [
    { label: "Final total due", value: formatPdfMoney(input.totalDue) },
  ]);
  drawSectionTitle(writer, "Drivers With Positive Balances");

  if (input.drivers.length === 0) {
    drawWrappedText(writer, "No drivers currently have a positive outstanding balance.", {
      color: MUTED_COLOR,
    });
  } else {
    for (const driver of input.drivers) {
      const balance = formatPdfMoney(driver.balance);
      const license = `License: ${driver.licenseNumber}`;
      const totals = `Commissions: ${formatPdfMoney(driver.totalCommissions)} | Payments: ${formatPdfMoney(driver.totalPayments)}`;
      const entryHeight =
        entryHeaderLayout(writer, driver.name, balance).height +
        wrapText(license, writer.regular, 9, PAGE_WIDTH - MARGIN * 2).length * 13 +
        wrapText(totals, writer.regular, 9, PAGE_WIDTH - MARGIN * 2).length * 13 +
        18;
      ensureSpace(writer, entryHeight);
      drawEntryHeader(writer, driver.name, balance);
      drawWrappedText(writer, license, {
        size: 9,
        color: MUTED_COLOR,
      });
      drawWrappedText(
        writer,
        totals,
        { size: 9, color: MUTED_COLOR },
      );
      drawEntryDivider(writer);
    }
  }

  return finishReport(writer);
}
