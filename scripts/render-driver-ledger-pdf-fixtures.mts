import { mkdir, writeFile } from "node:fs/promises";
import { resolveCommissionPresentation } from "../src/lib/drivers/commissionPresentation.ts";
import { buildDriverLedgerPdf } from "../src/lib/drivers/pdf.ts";

const outputDirectory = "tmp/pdfs";
await mkdir(outputDirectory, { recursive: true });

const reservation = (index: number, long = false) => ({
  ...resolveCommissionPresentation({
    entryDate: new Date("2026-08-19T00:00:00.000Z"),
    reservation: {
      id: `RSV-2026-08-${String(index).padStart(3, "0")}`,
      startAt: new Date(Date.UTC(2026, 7, 19, 8 + (index % 10), index % 60)),
      pickupText: long
        ? `Barcelona Airport Terminal 1, arrivals meeting point ${"near the information desk and passenger assistance area ".repeat(5)}`
        : "Barcelona Airport Terminal 1",
      dropoffText: long
        ? `Hotel Arts Barcelona, Carrer de la Marina ${"main entrance beside the waterfront promenade ".repeat(5)}`
        : "Hotel Arts Barcelona",
    },
  }),
  amount: "12.00",
});

const shared = {
  driverName: "Visual QA Driver",
  licenseNumber: "VTC-QA-2026",
  generatedDate: "17 Sep 2026",
  totalCommissions: "271.00",
  totalPayments: "50.00",
  totalSubscriptionCharges: "20.00",
  balance: "221.00",
  payments: [{ date: "10 Sep 2026", method: "Bank", amount: "50.00", commissionAmount: "30.00", subscriptionAllocations: [{ month: "September 2026", amount: "20.00" }] }],
  subscriptions: [{ month: "September 2026", amount: "20.00", paid: "20.00", remaining: "0.00", status: "Paid" }],
};

const manual = {
  ...resolveCommissionPresentation({
    entryDate: new Date("2026-08-19T00:00:00.000Z"),
    manualPickupText: null,
    manualDropoffText: null,
  }),
  amount: "7.00",
};

await writeFile(
  `${outputDirectory}/driver-ledger-one-page.pdf`,
  await buildDriverLedgerPdf({ ...shared, commissions: [reservation(1), reservation(2), manual] }),
);
await writeFile(
  `${outputDirectory}/driver-ledger-multipage.pdf`,
  await buildDriverLedgerPdf({
    ...shared,
    commissions: [reservation(1, true), manual, ...Array.from({ length: 24 }, (_, index) => reservation(index + 2))],
  }),
);

console.log(`${outputDirectory}/driver-ledger-one-page.pdf`);
console.log(`${outputDirectory}/driver-ledger-multipage.pdf`);
