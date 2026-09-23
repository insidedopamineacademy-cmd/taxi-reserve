"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { securityRequestHeaders } from "@/lib/security/securityRequestGuard";

type DeleteDriverButtonProps = {
  id: string;
  name: string;
  licenseNumber: string;
  /** Called after a successful (or already-deleted) delete for optimistic UI. */
  onDeleted?: (id: string) => void;
  /** When set, navigate here on success instead of refreshing in place. */
  redirectTo?: string;
};

export default function DeleteDriverButton({ id, name, licenseNumber, onDeleted, redirectTo }: DeleteDriverButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-10 items-center justify-center rounded-lg border border-danger/30 px-3 text-sm font-medium text-danger hover:bg-danger/10 disabled:opacity-60"
      >
        Delete
      </button>
      {open ? (
        <DeleteDriverDialog
          id={id}
          name={name}
          licenseNumber={licenseNumber}
          close={() => setOpen(false)}
          onDeleted={onDeleted}
          redirectTo={redirectTo}
        />
      ) : null}
    </>
  );
}

function DeleteDriverDialog({
  id,
  name,
  licenseNumber,
  close,
  onDeleted,
  redirectTo,
}: {
  id: string;
  name: string;
  licenseNumber: string;
  close: () => void;
  onDeleted?: (id: string) => void;
  redirectTo?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);

  async function confirmDelete() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setLocked(false);
    try {
      const response = await fetch(`/api/drivers/${id}`, {
        method: "DELETE",
        headers: securityRequestHeaders(false),
      });

      // 404 means the driver is already gone — treat as success so the list
      // reconciles rather than showing a stale row.
      if (response.ok || response.status === 404) {
        onDeleted?.(id);
        if (redirectTo) router.push(redirectTo);
        else router.refresh();
        return;
      }

      const result = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
      if (response.status === 423 || result.code === "SETTINGS_LOCKED") {
        setLocked(true);
        setError(result.error || "Unlock protected settings to delete a driver.");
        setSubmitting(false);
        return;
      }
      throw new Error(result.error || "Could not delete the driver.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete the driver.");
      setSubmitting(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby="delete-driver-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!submitting) close();
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl border border-app-border bg-surface p-5 text-white shadow-xl backdrop:bg-black/70 sm:p-6"
    >
      <h2 id="delete-driver-title" className="text-xl font-semibold">
        Delete driver?
      </h2>
      <p className="mt-2 break-words text-sm text-muted">
        {name} · License {licenseNumber}
      </p>
      <p className="mt-4 text-sm leading-6 text-muted">
        Are you sure you want to delete this driver? They will be removed from all
        driver lists, selectors and reports, and will not receive future
        subscription charges. Historical reservations, commissions, payments and
        subscription records are preserved.
      </p>
      {error ? (
        <p role="alert" className="mt-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {error}
          {locked ? (
            <>
              {" "}
              <Link href={`/settings?next=${encodeURIComponent("/drivers")}`} className="font-semibold underline">
                Unlock settings
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
      <div className="mt-5 flex flex-wrap justify-end gap-3">
        <button
          type="button"
          disabled={submitting}
          onClick={close}
          className="min-h-11 rounded-lg border border-app-border px-4 text-sm hover:bg-surface-2 disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={() => void confirmDelete()}
          className="min-h-11 rounded-lg bg-danger px-4 text-sm font-semibold text-white disabled:opacity-60"
        >
          {submitting ? "Deleting…" : "Delete"}
        </button>
      </div>
    </dialog>
  );
}
