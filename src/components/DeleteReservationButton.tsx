"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";

export default function DeleteReservationButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <button
      className="text-xs text-red-600 hover:underline disabled:opacity-50"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const ok = confirm("Delete this reservation?");
          if (!ok) return;

          const res = await fetch(`/api/reservations/${id}`, { method: "DELETE" });

          if (res.ok) {
            // ✅ Give the backend a moment to commit before refreshing
            await new Promise((r) => setTimeout(r, 150));
            router.refresh();
          } else {
            alert("Delete failed");
          }
        })
      }
    >
      {pending ? "Deleting..." : "Delete"}
    </button>
  );
}
