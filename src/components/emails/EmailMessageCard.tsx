import { sanitizeEmailHtml } from "@/lib/emails/content";

type Attachment = {
  id: string;
  filename: string;
  mimeType: string | null;
  size: number | null;
};

type Message = {
  id: string;
  fromEmail: string | null;
  fromName: string | null;
  toEmails: string | null;
  ccEmails: string | null;
  bodyHtml: string | null;
  bodyText: string | null;
  direction: "INCOMING" | "OUTGOING";
  receivedAt: Date | null;
  sentAt: Date | null;
  createdAt: Date;
  attachments: Attachment[];
};

function formatBytes(value: number | null) {
  if (value === null) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default function EmailMessageCard({ message }: { message: Message }) {
  const outgoing = message.direction === "OUTGOING";
  const date = message.sentAt ?? message.receivedAt ?? message.createdAt;
  const sender = message.fromName || message.fromEmail || (outgoing ? "Taxi Reserve" : "Unknown sender");

  return (
    <article
      className={`rounded-2xl border p-4 ${
        outgoing ? "ml-5 border-yellow-400/20 bg-yellow-400/[0.06]" : "mr-5 border-white/10 bg-[#111827]"
      }`}
    >
      <header className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words font-semibold text-white">{sender}</p>
          <p className="break-all text-xs text-neutral-400">
            {outgoing ? `To: ${message.toEmails || "Unknown"}` : message.fromEmail}
          </p>
          {message.ccEmails ? <p className="break-all text-xs text-neutral-500">Cc: {message.ccEmails}</p> : null}
        </div>
        <time className="shrink-0 text-right text-xs text-neutral-400" dateTime={date.toISOString()}>
          {new Intl.DateTimeFormat("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          }).format(date)}
        </time>
      </header>

      <div className="mt-4 overflow-x-auto text-[15px] leading-6 text-neutral-100">
        {message.bodyHtml ? (
          <div
            className="email-html min-w-0 break-words"
            dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(message.bodyHtml) }}
          />
        ) : (
          <p className="whitespace-pre-wrap break-words">{message.bodyText || "No message body."}</p>
        )}
      </div>

      {message.attachments.length ? (
        <div className="mt-4 border-t border-white/10 pt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Attachments</p>
          <div className="mt-2 grid gap-2">
            {message.attachments.map((attachment) => (
              <div key={attachment.id} className="min-w-0 rounded-xl bg-black/25 px-3 py-2">
                <p className="truncate text-sm text-white">{attachment.filename}</p>
                <p className="text-xs text-neutral-400">
                  {[attachment.mimeType, formatBytes(attachment.size)].filter(Boolean).join(" · ")}
                  {" · Available in MXRoute"}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}
