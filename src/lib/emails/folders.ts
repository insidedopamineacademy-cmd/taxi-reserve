import type { ListResponse } from "imapflow";

export const EMAIL_FOLDERS = ["INBOX", "SENT", "SPAM", "ARCHIVE", "TRASH"] as const;
export type EmailFolder = (typeof EMAIL_FOLDERS)[number];

export const EMAIL_FOLDER_OPTIONS: Array<{
  folder: EmailFolder;
  key: string;
  label: string;
}> = [
  { folder: "INBOX", key: "inbox", label: "Inbox" },
  { folder: "SENT", key: "sent", label: "Sent" },
  { folder: "SPAM", key: "spam", label: "Spam" },
  { folder: "ARCHIVE", key: "archive", label: "Archive" },
  { folder: "TRASH", key: "trash", label: "Trash" },
];

const SPECIAL_USE_FOLDERS: Record<string, EmailFolder> = {
  "\\inbox": "INBOX",
  "\\sent": "SENT",
  "\\junk": "SPAM",
  "\\trash": "TRASH",
  "\\archive": "ARCHIVE",
};

const NAME_FOLDERS: Record<string, EmailFolder> = {
  inbox: "INBOX",
  sent: "SENT",
  sentmail: "SENT",
  sentmessages: "SENT",
  junk: "SPAM",
  junkmail: "SPAM",
  spam: "SPAM",
  trash: "TRASH",
  deleted: "TRASH",
  deletedmessages: "TRASH",
  archive: "ARCHIVE",
  archives: "ARCHIVE",
};

function normalizedMailboxName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function classifyMailbox(mailbox: Pick<ListResponse, "path" | "name" | "specialUse">) {
  const specialUse = mailbox.specialUse?.toLowerCase();
  if (specialUse && SPECIAL_USE_FOLDERS[specialUse]) return SPECIAL_USE_FOLDERS[specialUse];

  const candidates = [mailbox.name, mailbox.path.split(/[/.]/).pop() ?? mailbox.path];
  for (const candidate of candidates) {
    const folder = NAME_FOLDERS[normalizedMailboxName(candidate)];
    if (folder) return folder;
  }
  return null;
}

export function parseEmailFolder(value?: string | null): EmailFolder {
  const key = value?.trim().toLowerCase();
  return EMAIL_FOLDER_OPTIONS.find((option) => option.key === key)?.folder ?? "INBOX";
}

export function emailFolderKey(folder: EmailFolder) {
  return EMAIL_FOLDER_OPTIONS.find((option) => option.folder === folder)?.key ?? "inbox";
}

export function emailFolderLabel(folder: EmailFolder) {
  return EMAIL_FOLDER_OPTIONS.find((option) => option.folder === folder)?.label ?? "Inbox";
}
