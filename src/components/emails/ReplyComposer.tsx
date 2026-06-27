"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function ReplyComposer({ threadId, recipient }: { threadId: string; recipient: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanBody = body.trim();
    if (!cleanBody) {
      setIsError(true);
      setMessage("Write a reply before sending.");
      return;
    }

    setSending(true);
    setMessage("");
    setIsError(false);
    try {
      const response = await fetch("/api/emails/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, body: cleanBody }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Reply could not be sent.");

      setBody("");
      setMessage("Reply sent");
      router.refresh();
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : "Reply could not be sent.");
    } finally {
      setSending(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="sticky bottom-0 z-20 mt-4 rounded-t-2xl border border-b-0 border-white/10 bg-[#111827]/95 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-2xl backdrop-blur sm:static sm:rounded-2xl sm:border-b"
    >
      <label htmlFor="email-reply" className="block text-sm font-medium text-white">
        Reply to <span className="break-all text-neutral-300">{recipient}</span>
      </label>
      <textarea
        id="email-reply"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        maxLength={20_000}
        rows={4}
        placeholder="Write your reply…"
        className="mt-2 min-h-28 w-full resize-y rounded-xl border border-white/15 bg-black/30 p-3 text-base text-white outline-none placeholder:text-neutral-500 focus:border-yellow-400"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <p
          aria-live="polite"
          className={`min-w-0 text-sm ${isError ? "text-red-300" : "text-emerald-300"}`}
        >
          {message}
        </p>
        <button
          type="submit"
          disabled={sending || !body.trim()}
          className="min-h-12 shrink-0 rounded-xl bg-yellow-400 px-6 font-semibold text-black transition hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send reply"}
        </button>
      </div>
    </form>
  );
}
