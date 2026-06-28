type Props = {
  imapConfigured: boolean;
  smtpConfigured: boolean;
  compact?: boolean;
};

export default function EmailConfigNotice({ imapConfigured, smtpConfigured, compact = false }: Props) {
  if (imapConfigured && smtpConfigured) return null;

  return (
    <div className={`${compact ? "mt-3" : "mt-4"} rounded-xl border border-amber-400/25 bg-amber-400/[0.07] px-4 py-3`}>
      {!imapConfigured ? (
        <p className="text-sm leading-5 text-amber-100">
          Inbox sync is unavailable because the server-side IMAP settings are incomplete.
          Stored emails remain readable.
        </p>
      ) : null}
      {!smtpConfigured ? (
        <p className={`text-sm leading-5 text-amber-100 ${!imapConfigured ? "mt-2" : ""}`}>
          Replies are unavailable because SMTP settings are incomplete.
        </p>
      ) : null}
    </div>
  );
}
