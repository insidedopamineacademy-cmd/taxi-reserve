import Link from "next/link";
import DriverBalanceList from "@/components/drivers/DriverBalanceList";
import {
  formatBalanceEuro,
  formatBalanceSubscriptionMonth,
  prepareDriverBalanceReport,
  type DriverBalanceKind,
} from "@/lib/drivers/balanceReport";
import { requireDriverAdminPage } from "@/lib/drivers/access";
import { getDriverBalanceLines } from "@/lib/drivers/overview";
import { getMadridFinancialPeriods } from "@/lib/drivers/financialDateCore";

export default async function DriverBalancePage({ kind }: { kind: DriverBalanceKind }) {
  await requireDriverAdminPage();
  const now = new Date();
  const report = prepareDriverBalanceReport(await getDriverBalanceLines(now), kind);
  const due = kind === "due";
  const month = formatBalanceSubscriptionMonth(getMadridFinancialPeriods(now).monthStart);
  const items = report.drivers.map((driver) => ({
    ...driver,
    balance: formatBalanceEuro(driver.balance),
    subscription: formatBalanceEuro(driver.subscription),
  }));

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <Link href="/drivers" className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-muted hover:text-brand"><span aria-hidden="true">‹</span> Drivers</Link>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">{due ? "Comisiones pendientes" : "Créditos de conductores"}</h1>
          <p className="mt-1 text-sm text-muted">{due ? "Conductores con saldo pendiente de pago a la empresa." : "Conductores con saldo a su favor."}</p>
        </div>
        {due && <a href="/api/drivers/due-pdf" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-app-border bg-surface px-4 text-sm font-medium text-white hover:border-brand/40 hover:text-brand">Descargar PDF completo<span className="sr-only"> (abre en otra pestaña)</span></a>}
      </div>
      <section aria-label={due ? "Total pendiente" : "Total crédito"} className={`rounded-xl border p-4 sm:p-5 ${due ? "border-warning/25 bg-warning/[0.06]" : "border-success/25 bg-success/[0.06]"}`}>
        <p className="text-sm text-muted">{due ? "Total pendiente" : "Total crédito"}</p>
        <p className={`tnum mt-2 break-words text-3xl font-semibold ${due ? "text-warning" : "text-success"}`}>{formatBalanceEuro(report.total)}</p>
        <p className="mt-2 text-xs text-muted">Total de todos los conductores de esta vista. La búsqueda solo filtra la lista.</p>
      </section>
      {due && <p className="mt-4 text-sm leading-relaxed text-muted">Suscripción de {month}. Los pagos cubren primero las suscripciones más antiguas; la asignación mostrada no vuelve a descontarse del saldo.</p>}
      <DriverBalanceList items={items} kind={kind} />
    </main>
  );
}
