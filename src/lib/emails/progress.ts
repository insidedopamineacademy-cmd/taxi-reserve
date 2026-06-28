import type { EmailFolder } from "@/lib/emails/folders";

export type EmailSyncStepStatus = "pending" | "success" | "warning" | "error";

export type EmailSyncStep = {
  status: EmailSyncStepStatus;
  label: string;
  detail?: string;
  folder?: EmailFolder;
  count?: number;
};

export type EmailSyncSummary = {
  foldersChecked: number;
  foldersSynced: number;
  messagesImported: number;
  duplicatesSkipped: number;
};

export type EmailSyncResult = {
  ok: boolean;
  steps: EmailSyncStep[];
  summary: EmailSyncSummary;
};

export class EmailSyncProgressCollector {
  readonly steps: EmailSyncStep[] = [];
  readonly summary: EmailSyncSummary = {
    foldersChecked: 0,
    foldersSynced: 0,
    messagesImported: 0,
    duplicatesSkipped: 0,
  };

  add(step: EmailSyncStep) {
    this.steps.push(step);
  }

  result(ok: boolean): EmailSyncResult {
    return {
      ok,
      steps: [...this.steps],
      summary: { ...this.summary },
    };
  }
}
