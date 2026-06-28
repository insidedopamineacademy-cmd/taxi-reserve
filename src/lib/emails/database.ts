import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const EMAIL_TABLES = [
  'public."EmailThread"',
  'public."EmailMessage"',
  'public."EmailAttachment"',
  'public."EmailSyncState"',
] as const;

export function isEmailInboxSchemaError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2021" || error.code === "P2022")
  );
}

export async function isEmailInboxSchemaReady() {
  const [status] = await prisma.$queryRaw<Array<{ ready: boolean }>>(Prisma.sql`
    SELECT (
      to_regclass(${EMAIL_TABLES[0]}) IS NOT NULL
      AND to_regclass(${EMAIL_TABLES[1]}) IS NOT NULL
      AND to_regclass(${EMAIL_TABLES[2]}) IS NOT NULL
      AND to_regclass(${EMAIL_TABLES[3]}) IS NOT NULL
      AND NOT EXISTS (
        SELECT required.column_name
        FROM (VALUES ('folder'), ('folders'), ('mailbox'), ('mailboxes'), ('imapUid'))
          AS required(column_name)
        WHERE NOT EXISTS (
          SELECT 1
          FROM information_schema.columns column_info
          WHERE column_info.table_schema = 'public'
            AND column_info.table_name = 'EmailMessage'
            AND column_info.column_name = required.column_name
        )
      )
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
    if (isEmailInboxSchemaError(error)) return 0;
    throw error;
  }
}
