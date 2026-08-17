import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Prisma } from "@prisma/client";
import {
  buildDueCommissionsPdf,
  prepareDueCommissionsReport,
  type DueCommissionBalanceLine,
} from "../src/lib/drivers/duePdf.ts";

const outputPath = resolve(
  process.argv[2] ?? "output/pdf/pending-commissions-sample.pdf",
);

const names = [
  "Muneeb",
  "Farrakh",
  "Maradona",
  "Mehboob",
  "Raja Adnan",
  "Gurbinder Singh",
  "Waqas Hussain",
  "Naeem Sarwar",
  "Abdullah",
  "Junaid",
  "Noman",
  "HostelFly",
];

const visualMoneyFixtures = [
  "1234567.89",
  "1935.00",
  "161.00",
  "78.00",
  "8.00",
  "3.00",
] as const;

const fixture: DueCommissionBalanceLine[] = Array.from(
  { length: 52 },
  (_, index) => ({
    id: `fixture-${String(index + 1).padStart(2, "0")}`,
    name:
      index === 17
        ? "Alejandro Fernández de la Cruz y Martínez Operations Partner"
        : `${names[index % names.length]} ${index + 1}`,
    licenseNumber:
      index === 22
        ? "VTC-047-048-PMR-LONG-LICENCE"
        : index === 31
          ? null
          : index % 9 === 0
            ? "VTC"
            : String(1000 + index),
    summary: {
      balance: new Prisma.Decimal(
        visualMoneyFixtures[index] ??
          `${(index * 37) % 980 + 12}.${String(index % 100).padStart(2, "0")}`,
      ),
    },
  }),
);

fixture.push(
  {
    id: "fixture-zero",
    name: "Excluded Zero Balance",
    licenseNumber: "ZERO",
    summary: { balance: new Prisma.Decimal("0.00") },
  },
  {
    id: "fixture-credit",
    name: "Excluded Credit Balance",
    licenseNumber: "CREDIT",
    summary: { balance: new Prisma.Decimal("-85.00") },
  },
);

const report = prepareDueCommissionsReport(fixture);
const bytes = await buildDueCommissionsPdf({
  generatedDate: "18 Aug 2026",
  ...report,
});

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, bytes);
process.stdout.write(`${outputPath}\n`);
