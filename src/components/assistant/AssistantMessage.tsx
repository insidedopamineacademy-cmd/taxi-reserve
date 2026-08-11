"use client";

import { memo } from "react";
import { AssistantAvatar } from "./AssistantAvatar";
import { AssistantStatus } from "./AssistantStatus";
import { ReservationResultCard } from "./ReservationResultCard";
import { DriverResultCard } from "./DriverResultCard";
import { DriverFinancialSummaryCard } from "./DriverFinancialSummaryCard";
import { DriverTransactionsCard } from "./DriverTransactionsCard";
import { AssistantActionPreviewCard } from "./AssistantActionPreviewCard";
import { ReservationDraftCard } from "./ReservationDraftCard";
import { DriverImportDraftCard } from "./DriverImportDraftCard";
import type { AssistantMessage as AssistantMessageType } from "./types";

type Props = {
  message: AssistantMessageType;
  showAssistantAvatar: boolean;
  onRetry: () => void;
  onConfirmAction: (actionId: string) => void;
  onCancelAction: (actionId: string) => void;
};

export const AssistantMessage = memo(function AssistantMessage({ message, showAssistantAvatar, onRetry, onConfirmAction, onCancelAction }: Props) {
  const isUser = message.role === "user";

  return (
    <div className={`flex min-w-0 gap-2.5 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser ? (
        showAssistantAvatar ? (
          <AssistantAvatar size="small" className="mt-1" />
        ) : (
          <span className="size-7 shrink-0" aria-hidden="true" />
        )
      ) : null}

      <div
        className={
          isUser
            ? "assistant-message-copy max-w-[86%] rounded-2xl rounded-br-md bg-amber-300 px-3.5 py-2.5 text-sm leading-6 text-[#101827]"
            : "assistant-message-copy min-w-0 max-w-[calc(100%-38px)] space-y-2 text-sm leading-6 text-slate-200"
        }
      >
        {message.parts.map((part, index) => {
          const key = `${message.id}-${part.type}-${index}`;

          if (part.type === "text") {
            return (
              <p key={key} className="whitespace-pre-wrap">
                {part.text}
              </p>
            );
          }

          if (part.type === "status") {
            return <AssistantStatus key={key} status={part.status} label={part.label} />;
          }

          if (part.type === "reservation") {
            return <ReservationResultCard key={key} reservation={part.reservation} />;
          }

          if (part.type === "driver") {
            return <DriverResultCard key={key} driver={part.driver} />;
          }

          if (part.type === "driver-financial-summary") {
            return <DriverFinancialSummaryCard key={key} summary={part.summary} />;
          }

          if (part.type === "driver-transactions") {
            return <DriverTransactionsCard key={key} transactions={part.transactions} />;
          }

          if (part.type === "action-preview") {
            return (
              <AssistantActionPreviewCard
                key={key}
                action={part.action}
                onConfirm={onConfirmAction}
                onCancel={onCancelAction}
              />
            );
          }

          if (part.type === "reservation-draft") {
            return <ReservationDraftCard key={key} draft={part.draft} />;
          }

          if (part.type === "driver-import-draft") {
            return <DriverImportDraftCard key={key} draft={part.draft} />;
          }

          if (part.type === "interrupted") {
            return (
              <div key={key} className="inline-flex min-h-9 items-center rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-400">
                {part.message}
              </div>
            );
          }

          return (
            <div key={key} className="rounded-xl border border-rose-300/20 bg-rose-300/[0.06] p-3">
              <p className="font-medium text-rose-100">{part.title}</p>
              <p className="mt-1 text-sm leading-5 text-slate-300">{part.message}</p>
              {part.retryable ? (
                <button
                  type="button"
                  onClick={onRetry}
                  className="mt-2 inline-flex min-h-11 items-center rounded-lg border border-white/15 px-3 text-sm font-medium text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                >
                  Retry
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
});
