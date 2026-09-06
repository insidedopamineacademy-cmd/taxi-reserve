import { decode, type JWTDecodeParams } from "next-auth/jwt";
import { prisma } from "@/lib/prisma";
import { validateDeviceSession } from "./sessionCore";

/** The shared decoder is used by NextAuth server sessions and middleware. */
export async function decodeRegisteredToken(params: JWTDecodeParams) {
  const token = await decode(params).catch(() => null);
  if (!token) return null;
  const record = await validateDeviceSession(prisma, token);
  if (!record) return null;
  return {
    ...token, sub: record.userId, sid: record.id, email: record.user.email,
    name: record.user.name, role: record.user.role,
    sessionExpiresAt: record.expiresAt.toISOString(),
    locationVerifiedAt: record.locationVerifiedAt?.toISOString() ?? null,
  };
}
