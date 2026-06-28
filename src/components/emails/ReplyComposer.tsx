"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  threadId: string;
  recipient: string;
  available: boolean;
  unavailableReason?: string;
};

export default function ReplyComposer({
  threadId,
  recipient,
  available,
  unavailableReason,
}: Props) {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    if (open) textareaRef.current?.focus();
  }, [open]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!available) return;
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
    <section
      aria-label="Reply"
      className="sticky bottom-0 z-20 mt-4 rounded-t-2xl border border-b-0 border-white/10 bg-[#111827]/95 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-2xl backdrop-blur sm:static sm:rounded-2xl sm:border-b"
    >
      {!open ? (
        <div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            disabled={!available}
            aria-expanded="false"
            aria-controls="email-reply-composer"
            className="flex min-h-12 w-full items-center justify-center rounded-xl bg-yellow-400 px-5 font-semibold text-black transition hover:bg-yellow-300 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-300"
          >
            Reply
          </button>
          {!available ? (
            <p className="mt-2 break-words rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-sm leading-5 text-amber-100">
              {unavailableReason || "Replies are currently unavailable."}
            </p>
          ) : null}
        </div>
      ) : (
        <form id="email-reply-composer" onSubmit={submit}>
          <div className="flex items-start justify-between gap-3">
            <label htmlFor="email-reply" className="min-w-0 text-sm font-medium text-white">
              Reply to <span className="break-all text-neutral-300">{recipient}</span>
            </label>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="min-h-10 shrink-0 rounded-lg border border-white/15 px-3 text-sm text-neutral-200 hover:bg-white/10"
            >
              Close
            </button>
          </div>
          <textarea
            ref={textareaRef}
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
              className={`min-w-0 break-words text-sm ${isError ? "text-red-300" : "text-emerald-300"}`}
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
      )}
    </section>
  );
}
