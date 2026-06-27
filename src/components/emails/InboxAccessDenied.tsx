import Link from "next/link";

export default function InboxAccessDenied() {
  return (
    <main className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-lg items-center px-4 py-10">
      <section className="w-full rounded-2xl border border-white/10 bg-[#0e1426] p-6 text-center shadow-xl">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-white/5 text-xl" aria-hidden="true">
          🔒
        </div>
        <h1 className="mt-4 text-xl font-semibold text-white">
          Inbox access not available for this account
        </h1>
        <p className="mt-2 text-sm leading-6 text-neutral-400">
          This shared mailbox is restricted to authorized Taxi Reserve accounts.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-yellow-400 px-5 font-semibold text-black transition hover:bg-yellow-300"
        >
          Return to dashboard
        </Link>
      </section>
    </main>
  );
}
