import assert from "node:assert/strict";
import test from "node:test";
import {
  PDFArray,
  PDFDocument,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";
import { resolveCommissionPresentation } from "../src/lib/drivers/commissionPresentation.ts";
import {
  buildDriverLedgerPdf,
  buildFullDriverLedgerPdf,
  type DriverLedgerPdfInput,
} from "../src/lib/drivers/pdf.ts";

function pageTexts(bytes: Uint8Array) {
  return PDFDocument.load(bytes).then((pdf) =>
    pdf.getPages().map((page) => {
      const contents = page.node.Contents();
      const streams =
        contents instanceof PDFArray
          ? contents.asArray().map((reference) => pdf.context.lookup(reference))
          : [contents];
      return streams
        .flatMap((stream) => {
          assert.ok(stream instanceof PDFRawStream);
          const operators = Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
          return [...operators.matchAll(/<([0-9A-F]+)>\s*Tj/g)].map((match) =>
            Buffer.from(match[1], "hex").toString("latin1"),
          );
        })
        .join(" ");
    }),
  );
}

const base: Omit<DriverLedgerPdfInput, "commissions"> = {
  driverName: "Ledger QA Driver",
  licenseNumber: "VTC-QA",
  generatedDate: "17 Sep 2026",
  totalCommissions: "39.00",
  totalPayments: "0.00",
  totalSubscriptionCharges: "20.00",
  balance: "39.00",
  payments: [],
  subscriptions: [],
};

const reservationA = {
  entryDate: new Date("2026-08-19T00:00:00.000Z"),
  reservation: {
    id: "reservation-A-authoritative",
    startAt: new Date("2026-08-19T12:30:00.000Z"),
    pickupText: "Barcelona Airport Terminal 1",
    dropoffText: "Hotel Arts Barcelona",
  },
  subscriptionCharge: null,
  manualPickupText: "must not appear",
  manualDropoffText: "must not appear",
};

test("reservation-backed commission uses the authoritative relationship for ride fields", async () => {
  const presentation = resolveCommissionPresentation(reservationA);
  assert.deepEqual(presentation, {
    date: "19 Aug 2026",
    time: "14:30",
    pickupText: "Barcelona Airport Terminal 1",
    dropoffText: "Hotel Arts Barcelona",
    classification: "Reservation commission",
    reference: "reservation-A-authoritative",
    source: "reservation",
  });

  const pages = await pageTexts(
    await buildDriverLedgerPdf({
      ...base,
      commissions: [{ ...presentation, amount: "12.00" }],
    }),
  );
  const text = pages.join(" ");
  assert.match(text, /19 Aug 2026 \| 14:30/);
  assert.match(text, /Pickup: Barcelona Airport Terminal 1/);
  assert.match(text, /Destination: Hotel Arts Barcelona/);
  assert.match(text, /EUR 12\.00/);
  assert.match(text, /Reference: reservation-A-authoritative/);
  assert.doesNotMatch(text, /must not appear/);
});

test("multiple entries stay paired and date/amount similarity never invents a ride", async () => {
  const reservationB = resolveCommissionPresentation({
    entryDate: reservationA.entryDate,
    reservation: {
      id: "reservation-B-authoritative",
      startAt: new Date("2026-08-19T17:45:00.000Z"),
      pickupText: "Sagrada Familia",
      dropoffText: "Port Vell",
    },
  });
  const manual = resolveCommissionPresentation({
    entryDate: reservationA.entryDate,
    manualPickupText: null,
    manualDropoffText: null,
  });
  assert.equal(manual.source, "unclassified");
  assert.equal(manual.reference, null);
  const provenManual = resolveCommissionPresentation({
    entryDate: reservationA.entryDate,
    manualPickupText: "Manual pickup snapshot",
    manualDropoffText: "Manual destination snapshot",
  });
  assert.equal(provenManual.source, "manual");
  assert.equal(provenManual.classification, "Manual commission");

  const text = (
    await pageTexts(
      await buildDriverLedgerPdf({
        ...base,
        commissions: [
          { ...resolveCommissionPresentation(reservationA), amount: "12.00" },
          { ...reservationB, amount: "12.00" },
          { ...manual, amount: "12.00" },
          { ...provenManual, amount: "3.00" },
        ],
      }),
    )
  ).join(" ");
  assert.ok(text.indexOf("reservation-A-authoritative") < text.indexOf("Sagrada Familia"));
  assert.ok(text.indexOf("reservation-B-authoritative") < text.indexOf("Commission entry"));
  assert.equal(text.match(/Reference: reservation-/g)?.length, 2);
  assert.match(text, /Type: Commission entry/);
  assert.match(text, /Type: Manual commission/);
});

test("linked subscription has a proven month classification and no fabricated route", async () => {
  const subscription = resolveCommissionPresentation({
    entryDate: new Date("2026-08-01T00:00:00.000Z"),
    subscriptionCharge: {
      id: "subscription-august",
      chargeMonth: new Date("2026-08-01T00:00:00.000Z"),
    },
  });
  const text = (
    await pageTexts(
      await buildDriverLedgerPdf({
        ...base,
        commissions: [{ ...subscription, amount: "20.00" }],
      }),
    )
  ).join(" ");
  assert.match(text, /Type: Subscription \| August 2026/);
  assert.match(text, /Reference: subscription-august/);
  assert.doesNotMatch(text, /Pickup:|Destination:/);
});

test("long routes wrap and multipage continuation headers repeat without splitting entries", async () => {
  const longPickup = `Barcelona Airport ${"very-long-pickup-segment ".repeat(18)}`.trim();
  const longDestination = `Costa Brava ${"very-long-destination-segment ".repeat(18)}`.trim();
  const commissions = Array.from({ length: 22 }, (_, index) => ({
    ...resolveCommissionPresentation({
      entryDate: new Date("2026-08-19T00:00:00.000Z"),
      reservation: {
        id: `reservation-wrap-${index}`,
        startAt: new Date(Date.UTC(2026, 7, 19, 8 + (index % 10), index)),
        pickupText: longPickup,
        dropoffText: longDestination,
      },
    }),
    amount: "12.00",
  }));
  const pages = await pageTexts(await buildDriverLedgerPdf({ ...base, commissions }));
  assert.ok(pages.length >= 4);
  assert.ok(pages.slice(1).every((page) => page.includes("Driver Ledger - continued")));
  assert.ok(pages.every((page) => /Page \d+ of \d+/.test(page)));
  assert.equal(pages.join(" ").match(/Reference: reservation-wrap-/g)?.length, 22);
});

test("full ledger uses the same ride presentation as the individual ledger", async () => {
  const commission = { ...resolveCommissionPresentation(reservationA), amount: "12.00" };
  const individual = (
    await pageTexts(await buildDriverLedgerPdf({ ...base, commissions: [commission] }))
  ).join(" ");
  const full = (
    await pageTexts(
      await buildFullDriverLedgerPdf({
        generatedAt: base.generatedDate,
        drivers: [
          {
            name: base.driverName,
            licenseNumber: base.licenseNumber,
            status: "ACTIVE",
            totalCommissions: base.totalCommissions,
            totalPayments: base.totalPayments,
            totalSubscriptionCharges: base.totalSubscriptionCharges,
            balance: base.balance,
            commissions: [commission],
            payments: [],
            subscriptions: [],
          },
        ],
      }),
    )
  ).join(" ");
  for (const field of [
    "19 Aug 2026 | 14:30",
    "Barcelona Airport Terminal 1",
    "Hotel Arts Barcelona",
    "reservation-A-authoritative",
    "EUR 12.00",
  ]) {
    assert.ok(individual.includes(field));
    assert.ok(full.includes(field));
  }
});
