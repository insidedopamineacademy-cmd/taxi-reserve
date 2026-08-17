// src/components/ReservationsTable.tsx
"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { updateReservationField } from "@/app/reservations/actions";
import { formatLocalInstantDateDisplay } from "@/lib/dateDisplay";
import { relTimeFromNow } from "@/lib/parseStartAt";

type Reservation = {
  id: string;
  startAt: string | Date;          // stored in UTC; string ISO or Date
  pickupText?: string | null;
  dropoffText?: string | null;
  pax: number;
  notes: string | null;
  priceEuro?: number | null;
  driver?: string | null;
};

const euro = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 0,
});

export default function ReservationsTable({ items }: { items: Reservation[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-700 bg-gray-900 text-gray-100">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-800 text-gray-200">
          <tr>
            <th className="px-4 py-2 font-medium">Time</th>
            <th className="px-4 py-2 font-medium">When</th>
            <th className="px-4 py-2 font-medium">From</th>
            <th className="px-4 py-2 font-medium">To</th>
            <th className="px-4 py-2 font-medium">Pax</th>
            <th className="px-4 py-2 font-medium">Driver</th>
            <th className="px-4 py-2 font-medium text-right">Price</th>
            <th className="px-4 py-2 font-medium">Notes</th>
            <th className="px-4 py-2 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <Row key={r.id} r={r} />
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={9} className="px-4 py-6 text-center text-gray-400">
                No reservations yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Row({ r }: { r: Reservation }) {
  const dt = typeof r.startAt === "string" ? new Date(r.startAt) : r.startAt;
  const dateTime = `${formatLocalInstantDateDisplay(dt)} · ${dt.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;

  // When chip
  const rel = relTimeFromNow(dt);
  const chipClass = rel.includes("ago")
    ? "bg-red-100 text-red-800"
    : rel.startsWith("in 0")
    ? "bg-orange-100 text-orange-800"
    : "bg-gray-100 text-gray-800";

  return (
    <tr className="border-t border-gray-700 hover:bg-gray-800/60">
      <td className="px-4 py-2 whitespace-nowrap">{dateTime}</td>
      <td className="px-4 py-2">
        <span className={`rounded px-2 py-0.5 text-xs ${chipClass}`}>{rel}</span>
      </td>
      <td className="px-4 py-2 max-w-[220px]">
        <Ellipsis text={r.pickupText || "—"} />
      </td>
      <td className="px-4 py-2 max-w-[220px]">
        <Ellipsis text={r.dropoffText || "—"} />
      </td>
      <td className="px-4 py-2 w-24">
        <EditablePax id={r.id} initial={r.pax} />
      </td>
      <td className="px-4 py-2 w-40">
        <EditableDriver id={r.id} initial={r.driver ?? ""} />
      </td>
      <td className="px-4 py-2 text-right">
        {typeof r.priceEuro === "number" ? euro.format(r.priceEuro) : "—"}
      </td>
      <td className="px-4 py-2 min-w-[220px]">
        <EditableNotes id={r.id} initial={r.notes ?? ""} />
      </td>
      <td className="px-4 py-2 text-right">
        <Link
          href={`/reservations/${r.id}/edit`}
          className="inline-block rounded-md border border-gray-600 bg-gray-800 px-3 py-1 text-gray-100 hover:bg-gray-700"
        >
          Edit
        </Link>
      </td>
    </tr>
  );
}

function Ellipsis({ text }: { text: string }) {
  return (
    <span className="block truncate" title={text}>
      {text}
    </span>
  );
}

function EditablePax({ id, initial }: { id: string; initial: number }) {
  const [val, setVal] = useState(String(initial));
  const [pending, start] = useTransition();

  function commit() {
    const next = Math.max(1, Math.min(99, Number(val)));
    setVal(String(next));
    start(async () => {
      try {
        await updateReservationField(id, { pax: next });
      } catch {
        setVal(String(initial));
      }
    });
  }

  return (
    <input
      type="number"
      min={1}
      max={99}
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) =>
        e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()
      }
      className="w-20 rounded-md border border-gray-600 bg-gray-800 px-2 py-1 text-right text-gray-100"
      disabled={pending}
    />
  );
}

function EditableDriver({ id, initial }: { id: string; initial: string }) {
  const [val, setVal] = useState(initial);
  const [pending, start] = useTransition();

  function commit() {
    const v = val.trim();
    start(async () => {
      try {
        await updateReservationField(id, { driver: v || null });
      } catch {
        /* noop */
      }
    });
  }

  return (
    <input
      type="text"
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) =>
        e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()
      }
      placeholder="Driver name/number"
      className="w-full rounded-md border border-gray-600 bg-gray-800 px-2 py-1 text-gray-100 placeholder-gray-400"
      disabled={pending}
    />
  );
}

function EditableNotes({ id, initial }: { id: string; initial: string }) {
  const [val, setVal] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();

  function commit() {
    if (!dirty) return;
    const snapshot = val;
    start(async () => {
      try {
        await updateReservationField(id, { notes: snapshot.trim() || null });
        setDirty(false);
      } catch {
        /* noop */
      }
    });
  }

  return (
    <textarea
      value={val}
      onChange={(e) => {
        setVal(e.target.value);
        setDirty(true);
      }}
      onBlur={commit}
      rows={2}
      placeholder="Add notes…"
      className="w-full resize-y rounded-md border border-gray-600 bg-gray-800 px-2 py-1 text-gray-100 placeholder-gray-400"
      disabled={pending}
    />
  );
}
