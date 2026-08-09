export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import DriverForm from "@/components/drivers/DriverForm";
import { requireDriverAdminPage } from "@/lib/drivers/access";

export default async function NewDriverPage() {
  await requireDriverAdminPage();

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-6 sm:px-6">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-white">New driver</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Add a driver to Taxi Reserve. New drivers are active by default.
        </p>
      </div>
      <section className="rounded-xl border border-white/10 bg-[#0e1426] p-4 sm:p-5">
        <DriverForm mode="create" />
      </section>
    </main>
  );
}
