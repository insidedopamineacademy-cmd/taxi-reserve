"use client";

import { useState } from "react";
import Link from "next/link";
import SubscriptionStatusBadge from "@/components/drivers/SubscriptionStatusBadge";
import type { SubscriptionDisplayStatus } from "@/lib/drivers/subscriptionStatus";

export type DriverBalanceListItem = {
  id: string;
  name: string;
  licenseNumber: string;
  balance: string;
  subscription: string;
  subscriptionStatus: SubscriptionDisplayStatus;
};

export default function DriverBalanceList({ items, kind }: {
  items: DriverBalanceListItem[];
  kind: "credits" | "due";
}) {
  const [query, setQuery] = useState("");
  const search = query.trim().toLocaleLowerCase();
  const filtered = items.filter((item) =>
    item.name.toLocaleLowerCase().includes(search) ||
    item.licenseNumber.toLocaleLowerCase().includes(search));
  const due = kind === "due";
  const balanceLabel = due ? "Pendiente" : "Crédito";
  const tone = due ? "text-warning" : "text-success";

  return (
    <section className="mt-6 space-y-4" aria-label={due ? "Conductores con saldo pendiente" : "Conductores con crédito"}>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted">Buscar conductor o licencia</span>
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nombre o número de licencia" className="h-11 w-full rounded-lg border border-app-border bg-surface-2 px-3 text-base text-white outline-none placeholder:text-subtle focus:border-brand/50 focus:ring-2 focus:ring-brand/25" />
      </label>
      <p role="status" className="text-xs text-subtle">
        {filtered.length} de {items.length} conductores · Nombre A–Z
      </p>
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-app-border bg-surface p-8 text-center text-sm text-muted">
          {items.length === 0
            ? due ? "No hay comisiones pendientes." : "No hay conductores con crédito."
            : "No hay conductores que coincidan con la búsqueda."}
          {search && <button type="button" onClick={() => setQuery("")} className="mx-auto mt-3 block min-h-11 px-3 font-medium text-brand hover:text-brand-hover">Borrar búsqueda</button>}
        </div>
      ) : (
        <>
          <ul className="grid gap-3 md:hidden">
            {filtered.map((driver) => (
              <li key={driver.id} className="min-w-0 rounded-xl border border-app-border bg-surface p-4">
                <Link href={`/drivers/${driver.id}`} className="flex min-h-11 items-start justify-between gap-3 font-semibold text-white hover:text-brand">
                  <span className="min-w-0 break-words">{driver.name}</span>
                  <span aria-hidden="true" className="shrink-0 text-subtle">›</span>
                  <span className="sr-only"> — Ver cuenta</span>
                </Link>
                <p className="break-all text-sm text-muted">Licencia {driver.licenseNumber}</p>
                <dl className="mt-4 space-y-2 border-t border-app-border pt-3">
                  {due && <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm"><dt className="text-muted">Suscripción</dt><dd className="text-right"><span className="tnum block whitespace-nowrap text-muted">{driver.subscription}</span><SubscriptionStatusBadge status={driver.subscriptionStatus} language="es" /></dd></div>}
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><dt className="text-sm text-muted">{balanceLabel}</dt><dd className={`tnum whitespace-nowrap text-lg font-semibold ${tone}`}>{driver.balance}</dd></div>
                </dl>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto rounded-xl border border-app-border bg-surface md:block">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{due ? "Comisiones pendientes por conductor" : "Crédito a favor de cada conductor"}</caption>
              <thead className="border-b border-app-border bg-surface-2 text-xs uppercase text-muted">
                <tr><th scope="col" className="w-[40%] px-4 py-3">Conductor</th><th scope="col" className="px-4 py-3">Licencia</th>{due && <th scope="col" className="px-4 py-3 text-right">Suscripción</th>}<th scope="col" className="px-4 py-3 text-right">{balanceLabel}</th></tr>
              </thead>
              <tbody className="divide-y divide-app-border">
                {filtered.map((driver) => (
                  <tr key={driver.id} className="even:bg-white/[0.015] hover:bg-white/[0.03]">
                    <th scope="row" className="max-w-0 px-4 py-1 font-medium"><Link href={`/drivers/${driver.id}`} className="flex min-h-11 items-center break-words py-2 text-white hover:text-brand">{driver.name}<span className="sr-only"> — Ver cuenta</span></Link></th>
                    <td className="max-w-40 break-all px-4 py-3 text-muted">{driver.licenseNumber}</td>
                    {due && <td className="px-4 py-3 text-right"><span className="tnum block whitespace-nowrap text-muted">{driver.subscription}</span><SubscriptionStatusBadge status={driver.subscriptionStatus} language="es" /></td>}
                    <td className={`tnum whitespace-nowrap px-4 py-3 text-right font-semibold ${tone}`}>{driver.balance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
