"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type DriverStatus = "ACTIVE" | "INACTIVE";
type DriverVehicleType = "VAN" | "SEDAN";

type DriverFormProps = {
  mode: "create" | "edit";
  initial?: {
    id: string;
    name: string;
    licenseNumber: string;
    vehicleType: DriverVehicleType | null;
    subscriptionExempt: boolean;
    status: DriverStatus;
  };
};

export default function DriverForm({ mode, initial }: DriverFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [licenseNumber, setLicenseNumber] = useState(initial?.licenseNumber ?? "");
  const [vehicleType, setVehicleType] = useState<DriverVehicleType | "">(
    initial?.vehicleType ?? "",
  );
  const [subscriptionExempt, setSubscriptionExempt] = useState(
    initial?.subscriptionExempt ?? false,
  );
  const [status, setStatus] = useState<DriverStatus>(initial?.status ?? "ACTIVE");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputClass =
    "h-11 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-base text-neutral-100 placeholder:text-neutral-500 outline-none focus:border-neutral-500 focus:ring-2 focus:ring-neutral-600/30";
  const labelClass = "mb-1 block text-sm text-neutral-300";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    const trimmedName = name.trim();
    const trimmedLicenseNumber = licenseNumber.trim();

    if (!trimmedName) {
      setError("Enter the driver's name.");
      return;
    }
    if (!trimmedLicenseNumber) {
      setError("Enter the driver's license number.");
      return;
    }
    if (!vehicleType) {
      setError("Select the driver's vehicle type.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch(
        mode === "create" ? "/api/drivers" : `/api/drivers/${initial?.id}`,
        {
          method: mode === "create" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: trimmedName,
            licenseNumber: trimmedLicenseNumber,
            vehicleType,
            subscriptionExempt,
            status,
          }),
        },
      );
      const result = (await response.json().catch(() => ({}))) as {
        driver?: { id: string };
        error?: string;
      };

      if (!response.ok) throw new Error(result.error || "Could not save the driver.");

      const driverId = result.driver?.id ?? initial?.id;
      router.push(driverId ? `/drivers/${driverId}` : "/drivers");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the driver.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <label>
        <span className={labelClass}>Name</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          maxLength={200}
          autoComplete="name"
          className={inputClass}
          placeholder="Driver name"
        />
      </label>

      <label>
        <span className={labelClass}>License number</span>
        <input
          value={licenseNumber}
          onChange={(event) => setLicenseNumber(event.target.value)}
          required
          maxLength={100}
          className={inputClass}
          placeholder="License number"
        />
      </label>

      <label>
        <span className={labelClass}>Vehicle type</span>
        <select
          value={vehicleType}
          onChange={(event) =>
            setVehicleType(event.target.value as DriverVehicleType | "")
          }
          required
          className={inputClass}
        >
          <option value="">Select vehicle type</option>
          <option value="VAN">VAN</option>
          <option value="SEDAN">SEDAN</option>
        </select>
        {mode === "edit" && !initial?.vehicleType ? (
          <span className="mt-1 block text-xs text-yellow-300">
            Required before this driver can receive monthly subscription charges.
          </span>
        ) : null}
      </label>

      <label>
        <span className={labelClass}>Status</span>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as DriverStatus)}
          className={inputClass}
        >
          <option value="ACTIVE">ACTIVE</option>
          <option value="INACTIVE">INACTIVE</option>
        </select>
      </label>

      <label className="flex items-start gap-3 rounded-md border border-white/10 bg-black/20 p-3">
        <input
          type="checkbox"
          checked={subscriptionExempt}
          onChange={(event) => setSubscriptionExempt(event.target.checked)}
          className="mt-0.5 h-5 w-5 rounded border-neutral-600 bg-neutral-950 accent-yellow-500"
        />
        <span>
          <span className="block text-sm font-medium text-neutral-200">
            Subscription Exempt
          </span>
          <span className="mt-0.5 block text-xs text-neutral-400">
            Exempt drivers do not receive future monthly subscription charges.
          </span>
        </span>
      </label>

      {error ? (
        <p role="alert" className="rounded-md border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={saving}
          className="h-11 rounded-md bg-yellow-500 px-4 font-semibold text-black hover:bg-yellow-400 disabled:cursor-wait disabled:opacity-60"
        >
          {saving ? "Saving..." : mode === "create" ? "Create driver" : "Save changes"}
        </button>
        <Link
          href={initial ? `/drivers/${initial.id}` : "/drivers"}
          className="inline-flex h-11 items-center rounded-md border border-white/10 px-4 text-sm font-medium text-neutral-200 hover:bg-white/5"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
