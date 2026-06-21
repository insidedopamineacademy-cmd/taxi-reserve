// src/components/SortControls.tsx
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export default function SortControls() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const sort = sp.get("sort") === "desc" ? "desc" : "asc";

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(sp?.toString() || "");
    params.set("sort", e.target.value);
    const url = `${pathname}?${params.toString()}`;
    router.replace(url);
    router.refresh();
  }

  return (
    <div className="mb-4 flex items-center gap-2">
      <label className="text-sm text-neutral-300">Sort by time:</label>
      <select
        value={sort}
        onChange={onChange}
        className="rounded-md border border-white/10 bg-black/30 px-3 py-1.5 text-sm"
      >
        <option value="asc">Oldest first</option>
        <option value="desc">Newest first</option>
      </select>
    </div>
  );
}
