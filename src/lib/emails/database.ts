import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const EMAIL_TABLES = [
  'public."EmailThread"',
  'public."EmailMessage"',
  'public."EmailAttachment"',
  'public."EmailSyncState"',
] as const;

export function isEmailInboxMissingTableError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021";
}

export async function isEmailInboxSchemaReady() {
  const [status] = await prisma.$queryRaw<Array<{ ready: boolean }>>(Prisma.sql`
    SELECT (
      to_regclass(${EMAIL_TABLES[0]}) IS NOT NULL
      AND to_regclass(${EMAIL_TABLES[1]}) IS NOT NULL
      AND to_regclass(${EMAIL_TABLES[2]}) IS NOT NULL
      AND to_regclass(${EMAIL_TABLES[3]}) IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM pg_type type
        JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
        WHERE namespace.nspname = 'public' AND type.typname = 'EmailDirection'
      )
    ) AS "ready"
  `);

  return status?.ready === true;
}

export async function getUnreadEmailCountSafely() {
  if (!(await isEmailInboxSchemaReady())) return 0;

  try {
    return await prisma.emailThread.count({ where: { unread: true } });
  } catch (error) {
    if (isEmailInboxMissingTableError(error)) return 0;
    throw error;
  }
}
