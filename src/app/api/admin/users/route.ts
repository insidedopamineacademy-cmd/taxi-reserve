export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { createManagedUser, listManagedUsers } from "@/lib/security/adminUsers";
import { SecurityError } from "@/lib/security/policy";
import { readSecurityJson, requireSameOrigin, requireSecuritySession, securityFailure, securityJson } from "@/lib/security/http";

export async function GET() {
  try {
    const { identity } = await requireSecuritySession({ admin: true, settingsUnlocked: true });
    return securityJson(await listManagedUsers(prisma, identity));
  } catch (error) {
    return securityFailure(error);
  }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const { identity } = await requireSecuritySession({ admin: true, settingsUnlocked: true });
    const body = await readSecurityJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new SecurityError(400, "INVALID_REQUEST", "Invalid user details.");
    const input = body as Record<string, unknown>;
    if (Object.keys(input).some(key => !["name", "email", "password", "confirmPassword"].includes(key)) || input.password !== input.confirmPassword) {
      throw new SecurityError(400, "INVALID_REQUEST", "Password confirmation must match.");
    }
    return securityJson({ user: await createManagedUser(prisma, identity, {
      name: input.name,
      email: input.email,
      password: input.password,
    }) }, 201);
  } catch (error) {
    return securityFailure(error);
  }
}
