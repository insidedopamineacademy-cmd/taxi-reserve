import "server-only";

import { createHash } from "node:crypto";

export function createAssistantSafetyIdentifier(userId: string) {
  return createHash("sha256")
    .update(`taxi-reserve-assistant:${userId}`)
    .digest("hex");
}
