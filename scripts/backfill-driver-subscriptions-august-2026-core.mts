export type ApprovedDriver = {
  driverId: string;
  vehicleType: "VAN" | "SEDAN";
  amount: "20.00" | "7.00";
};

export type BackfillArguments = {
  apply: boolean;
  actorEmail: string | null;
  executionId: string | null;
  approvals: ApprovedDriver[];
};

const APPROVAL_PATTERN = /^([^:]+):(VAN|SEDAN):(20\.00|7\.00)$/;

export function parseBackfillArguments(args: string[]): BackfillArguments {
  const parsed: BackfillArguments = {
    apply: false,
    actorEmail: null,
    executionId: null,
    approvals: [],
  };

  for (const argument of args) {
    if (argument === "--apply") {
      parsed.apply = true;
      continue;
    }
    if (argument === "--apply-all") {
      throw new Error("--apply-all is intentionally unsupported.");
    }
    if (argument.startsWith("--actor-email=")) {
      parsed.actorEmail = argument.slice("--actor-email=".length).trim().toLowerCase();
      continue;
    }
    if (argument.startsWith("--execution-id=")) {
      parsed.executionId = argument.slice("--execution-id=".length).trim();
      continue;
    }
    if (argument.startsWith("--approve=")) {
      const value = argument.slice("--approve=".length);
      const match = APPROVAL_PATTERN.exec(value);
      if (!match) {
        throw new Error(
          "Each --approve must use <driverId>:<VAN|SEDAN>:<20.00|7.00>.",
        );
      }
      const approval = {
        driverId: match[1],
        vehicleType: match[2] as ApprovedDriver["vehicleType"],
        amount: match[3] as ApprovedDriver["amount"],
      };
      const expectedAmount = approval.vehicleType === "VAN" ? "20.00" : "7.00";
      if (approval.amount !== expectedAmount) {
        throw new Error(
          `${approval.vehicleType} approval for ${approval.driverId} must use ${expectedAmount}.`,
        );
      }
      parsed.approvals.push(approval);
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  const uniqueIds = new Set(parsed.approvals.map((approval) => approval.driverId));
  if (uniqueIds.size !== parsed.approvals.length) {
    throw new Error("Each approved driver ID may appear only once.");
  }

  if (!parsed.apply && parsed.approvals.length > 0) {
    throw new Error("--approve is valid only together with --apply.");
  }
  if (parsed.apply) {
    if (parsed.approvals.length === 0) {
      throw new Error("--apply requires at least one explicit --approve entry.");
    }
    if (!parsed.actorEmail) {
      throw new Error("--apply requires --actor-email=<active-admin-email>.");
    }
    if (!parsed.executionId || !/^[A-Za-z0-9._-]{8,80}$/.test(parsed.executionId)) {
      throw new Error(
        "--apply requires --execution-id=<8-80 character review identifier>.",
      );
    }
  }

  return parsed;
}
