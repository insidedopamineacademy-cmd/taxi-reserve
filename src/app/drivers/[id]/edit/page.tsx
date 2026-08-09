export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { notFound } from "next/navigation";
import DriverForm from "@/components/drivers/DriverForm";
import { requireDriverAdminPage } from "@/lib/drivers/access";
import { prisma } from "@/lib/prisma";

type PageProps = { params: Promise<{ id: string }> };

export default async function EditDriverPage({ params }: PageProps) {
  await requireDriverAdminPage();
  const { id } = await params;
  const driver = await prisma.driver.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      licenseNumber: true,
      status: true,
    },
  });

  if (!driver) notFound();

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-6 sm:px-6">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-white">Edit driver</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Update operational details without changing financial history.
        </p>
      </div>
      <section className="rounded-xl border border-white/10 bg-[#0e1426] p-4 sm:p-5">
        <DriverForm mode="edit" initial={driver} />
      </section>
    </main>
  );
}
