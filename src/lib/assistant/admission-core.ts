export const ASSISTANT_RATE_LIMIT_WINDOW_MS = 60_000;

export type AssistantAdmissionLease = {
  allowed: true;
  release(): void;
};

export type AssistantAdmissionRejection = {
  allowed: false;
  reason: "ACTIVE_GENERATION" | "RATE_LIMIT";
  retryAfterSeconds: number;
};

export type AssistantAdmissionDecision =
  | AssistantAdmissionLease
  | AssistantAdmissionRejection;

type UserAdmissionState = {
  active: boolean;
  acceptedAt: number[];
};

export class AssistantAdmissionController {
  private readonly users = new Map<string, UserAdmissionState>();
  private admissionsSincePrune = 0;

  admit(
    userId: string,
    nowMs: number,
    maxRequestsPerMinute: number,
  ): AssistantAdmissionDecision {
    this.pruneIfNeeded(nowMs);

    const existing = this.users.get(userId);
    const state = existing ?? { active: false, acceptedAt: [] };
    state.acceptedAt = state.acceptedAt.filter(
      (acceptedAt) => acceptedAt > nowMs - ASSISTANT_RATE_LIMIT_WINDOW_MS,
    );

    if (state.active) {
      this.users.set(userId, state);
      return {
        allowed: false,
        reason: "ACTIVE_GENERATION",
        retryAfterSeconds: 1,
      };
    }

    if (state.acceptedAt.length >= maxRequestsPerMinute) {
      this.users.set(userId, state);
      const oldest = state.acceptedAt[0] ?? nowMs;
      return {
        allowed: false,
        reason: "RATE_LIMIT",
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((oldest + ASSISTANT_RATE_LIMIT_WINDOW_MS - nowMs) / 1_000),
        ),
      };
    }

    state.active = true;
    state.acceptedAt.push(nowMs);
    this.users.set(userId, state);

    let released = false;
    return {
      allowed: true,
      release: () => {
        if (released) return;
        released = true;
        const current = this.users.get(userId);
        if (!current) return;
        current.active = false;
      },
    };
  }

  private pruneIfNeeded(nowMs: number) {
    this.admissionsSincePrune += 1;
    if (this.admissionsSincePrune < 100) return;
    this.admissionsSincePrune = 0;

    for (const [userId, state] of this.users) {
      if (
        !state.active &&
        state.acceptedAt.every(
          (acceptedAt) => acceptedAt <= nowMs - ASSISTANT_RATE_LIMIT_WINDOW_MS,
        )
      ) {
        this.users.delete(userId);
      }
    }
  }
}
