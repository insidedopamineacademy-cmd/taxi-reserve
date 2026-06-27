import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export type EmailInboxAccess = {
  authenticated: boolean;
  allowed: boolean;
  email: string | null;
};

function allowedInboxUsers() {
  return new Set(
    (process.env.EMAIL_INBOX_ALLOWED_USERS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isEmailInboxUserAllowed(email?: string | null) {
  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail) return false;
  return allowedInboxUsers().has(normalizedEmail);
}

export async function getEmailInboxAccess(): Promise<EmailInboxAccess> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.trim() || null;

  return {
    authenticated: Boolean(email),
    allowed: isEmailInboxUserAllowed(email),
    email,
  };
}
