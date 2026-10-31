import type { Prisma, PrismaClient } from "@prisma/client";

// Single global row id. See prisma model SubscriptionAutomationSetting.
export const SUBSCRIPTION_AUTOMATION_ID = "global";

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Whether the automatic monthly subscription generator may create charges.
 * Defaults to enabled when no row exists, preserving pre-feature behaviour.
 */
export async function readSubscriptionAutomationEnabled(client: DbClient): Promise<boolean> {
  const row = await client.subscriptionAutomationSetting.findUnique({
    where: { id: SUBSCRIPTION_AUTOMATION_ID },
    select: { enabled: true },
  });
  return row?.enabled ?? true;
}

/**
 * Same read, but inside a transaction it locks the singleton row (SELECT ...
 * FOR UPDATE) so a pause request and a generator run serialise on it: once a
 * pause commits, a subsequent generator transaction observes disabled and
 * creates nothing. Defaults to enabled when no row exists.
 */
export async function readSubscriptionAutomationEnabledForUpdate(
  tx: Prisma.TransactionClient,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ enabled: boolean }>>`
    SELECT "enabled" FROM "SubscriptionAutomationSetting"
    WHERE "id" = ${SUBSCRIPTION_AUTOMATION_ID}
    FOR UPDATE
  `;
  return rows.length > 0 ? rows[0].enabled : true;
}
