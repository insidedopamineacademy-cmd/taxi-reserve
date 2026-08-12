import {
  normalizeDriverLicenseNumber,
  normalizeDriverName,
  normalizeDriverVehicleType,
  type DriverStatusCode,
  type DriverVehicleTypeCode,
} from "./profile-core.ts";

export const DRIVER_IMPORT_TEXT_MAX_LENGTH = 20_000;
export const DRIVER_IMPORT_MAX_ROWS = 48;
export const DRIVER_IMPORT_TTL_MS = 15 * 60 * 1_000;

export type DriverImportRowState =
  | "NEW"
  | "EXISTING_MATCH"
  | "EXISTING_UPDATE"
  | "DUPLICATE_IN_IMPORT"
  | "NEEDS_REVIEW"
  | "CONFLICT";

export type ExistingDriverImportSnapshot = {
  id: string;
  name: string;
  licenseNumber: string;
  vehicleType: DriverVehicleTypeCode | null;
  status: DriverStatusCode;
  subscriptionExempt: boolean;
  updatedAt: Date;
};

export type DriverImportRow = {
  id: string;
  sourceLine: string;
  name: string | null;
  licenseNumber: string | null;
  vehicleRaw: string | null;
  vehicleType: DriverVehicleTypeCode | null;
  sourceNotes: string[];
  possibleNames: string[];
  duplicateOccurrences: number;
  state: DriverImportRowState;
  issues: string[];
  existing: ExistingDriverImportSnapshot | null;
};

export type DriverImportDraftRecord = {
  id: string;
  ownerUserId: string;
  ownerEmail: string;
  revision: number;
  rows: DriverImportRow[];
  duplicateRowsSkipped: number;
  completeConfirmed: boolean;
  pendingActionId: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
};

export type DriverImportRowUpdate = {
  row_id: string;
  name: string | null;
  license_number: string | null;
  vehicle_type: DriverVehicleTypeCode | null;
};

export type DriverImportDraftUpdateArguments = {
  rows: DriverImportRowUpdate[];
  confirm_complete: boolean;
};

export type PrepareDriverImportArguments = {
  draft_id: string;
  revision: number;
};

export type DriverImportExistingRepository = {
  findCandidates(input: {
    licenseNumbers: string[];
    names: string[];
  }): Promise<ExistingDriverImportSnapshot[]>;
};

export type DriverImportPublicRow = Omit<DriverImportRow, "sourceLine" | "existing"> & {
  existing: null | {
    id: string;
    name: string;
    licenseNumber: string;
    vehicleType: DriverVehicleTypeCode | null;
    status: DriverStatusCode;
  };
};

export type DriverImportDraftPublic = {
  id: string;
  revision: number;
  counts: Record<DriverImportRowState, number>;
  duplicateRowsSkipped: number;
  blockingCount: number;
  completeConfirmed: boolean;
  readyToPrepare: boolean;
  question: string;
  rows: DriverImportPublicRow[];
};

export class DriverImportInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DriverImportInputError";
  }
}

function normalizedWords(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/mercedez/g, "mercedes")
    .replace(/turneo/g, "tourneo")
    .replace(/[^a-z0-9+]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeDriverIdentity(value: string) {
  return normalizedWords(value).replace(/\+/g, "plus");
}

const vehicleRules: Array<{
  pattern: RegExp;
  type: DriverVehicleTypeCode;
  canonical: string;
}> = [
  { pattern: /\b(?:(?:mercedes|mercedez)\s+)?v[ -]?class\b/i, type: "VAN", canonical: "Mercedes V-Class" },
  { pattern: /\b(?:mercedes|mercedez)\s+v\b/i, type: "VAN", canonical: "Mercedes V" },
  { pattern: /\b(?:(?:mercedes|mercedez)\s+)?vito\b/i, type: "VAN", canonical: "Mercedes Vito" },
  { pattern: /\b(?:volkswagen|vw)?\s*caravelle\b/i, type: "VAN", canonical: "Volkswagen Caravelle" },
  { pattern: /\b(?:volkswagen|vw)?\s*caddy\b/i, type: "VAN", canonical: "Volkswagen Caddy" },
  { pattern: /\b(?:ford\s+)?(?:tourneo|turneo)\b/i, type: "VAN", canonical: "Ford Tourneo" },
  { pattern: /\b(?:ford\s+)?custom\b/i, type: "VAN", canonical: "Ford Custom" },
  { pattern: /\b(?:fiat\s+)?talento\b/i, type: "VAN", canonical: "Fiat Talento" },
  { pattern: /\b(?:toyota\s+)?corolla\b/i, type: "SEDAN", canonical: "Toyota Corolla" },
  { pattern: /\b(?:toyota\s+)?camry\b/i, type: "SEDAN", canonical: "Toyota Camry" },
  { pattern: /\b(?:toyota\s+)?prius\s*\+/i, type: "SEDAN", canonical: "Toyota Prius+" },
  { pattern: /\b(?:toyota\s+)?rav\s*4\b/i, type: "SEDAN", canonical: "Toyota RAV4" },
  { pattern: /\b(?:lexus\s+)?es\s*300\b/i, type: "SEDAN", canonical: "Lexus ES300" },
];

export function classifyDriverVehicle(raw: string) {
  for (const rule of vehicleRules) {
    const match = rule.pattern.exec(raw);
    if (match) return { vehicleRaw: rule.canonical, vehicleType: rule.type, matchedText: match[0] };
  }
  const unknown = /\b(?:mercedes|mercedez|volkswagen|vw|ford|fiat|toyota|lexus|peugeot|renault|citroen)(?:\s+[a-z0-9+-]+)?\b/i.exec(raw);
  return unknown
    ? { vehicleRaw: unknown[0].trim(), vehicleType: null, matchedText: unknown[0] }
    : { vehicleRaw: null, vehicleType: null, matchedText: null };
}

function normalizeSourceLine(line: string) {
  return normalizedWords(line).replace(/[+]/g, "+");
}

function sourceNotes(line: string) {
  const notes: string[] = [];
  for (const match of line.matchAll(/\b(?:047|048|VTC|MTL|PMR|LLIC|8Px)\b/gi)) {
    notes.push(match[0]);
  }
  for (const match of line.matchAll(/\b(?:sin rampa|de noche|noche|conductor)\b[^,;]*/gi)) {
    notes.push(match[0].trim());
  }
  const suffix = /\s+-\s+(.+)$/.exec(line);
  if (suffix) notes.push(`Secondary text: ${suffix[1].trim()}`);
  return [...new Set(notes.map((note) => note.trim()).filter(Boolean))].slice(0, 10);
}

function findLicenseNumber(line: string, vehicleMatchedText: string | null) {
  let candidateText = line;
  if (vehicleMatchedText) candidateText = candidateText.replace(vehicleMatchedText, " ");
  candidateText = candidateText
    .replace(/\b(?:047|048|VTC|MTL|PMR|LLIC|8Px)\b/gi, " ")
    .replace(/\b(?:sin rampa|de noche|noche|conductor)\b.*$/gi, " ");
  const tokens = candidateText.match(/\b[A-Za-z0-9]{3,12}\b/g) ?? [];
  const token = tokens.find((value) => /\d/.test(value) && !/^ES300$/i.test(value));
  if (token) return normalizeDriverLicenseNumber(token);
  return /\bVTC\b/i.test(line) ? "VTC" : null;
}

function cleanNameSource(
  line: string,
  licenseNumber: string | null,
  vehicleMatchedText: string | null,
) {
  let value = line;
  const secondaryIndex = value.search(/(?:\s+[&+-]\s*)?(?:de\s+)?noche\b|\s+conductor\b|\s+-\s+/i);
  if (secondaryIndex >= 0) value = value.slice(0, secondaryIndex);
  if (licenseNumber) value = value.replace(new RegExp(`\\b${licenseNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), " ");
  if (vehicleMatchedText) value = value.replace(vehicleMatchedText, " ");
  value = value
    .replace(/\b(?:047|048|VTC|MTL|PMR|LLIC|8Px)\b/gi, " ")
    .replace(/\b(?:sin rampa)\b.*$/gi, " ")
    .replace(/[,;|]+$/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[\s.:;-]+$/g, "");
  return value;
}

function multipleNames(value: string, notes: string[]) {
  const hasConnector = /[&+,]|\s+y\s/i.test(value);
  const hasSecondary = notes.some((note) => /noche|conductor|Secondary text/i.test(note));
  if (!hasConnector && !hasSecondary) return [];
  const primary = value.split(/\s*(?:&|\+)\s*|\s+y\s+|\s*,\s*/i)
    .map((name) => name.trim().replace(/[\s.:;-]+$/g, ""))
    .filter(Boolean);
  for (const note of notes) {
    const night = /(?:de\s+)?noche\s+(.+?)(?:\s+conductor)?$/i.exec(note);
    if (night?.[1]) primary.push(night[1].trim());
    const secondary = /^Secondary text:\s*(.+)$/i.exec(note);
    if (secondary?.[1]) primary.push(secondary[1].trim());
  }
  return [...new Set(primary.map((name) => normalizeDriverName(name)))].slice(0, 6);
}

function initialRows(
  line: string,
  createRowId: (offset: number) => string,
): DriverImportRow[] {
  const vehicle = classifyDriverVehicle(line);
  const licenseNumber = findLicenseNumber(line, vehicle.matchedText);
  const notes = sourceNotes(line);
  const nameSource = cleanNameSource(line, licenseNumber, vehicle.matchedText);
  const parsedNames = multipleNames(nameSource, notes);
  const names = parsedNames.length > 0
    ? parsedNames
    : nameSource
      ? [normalizeDriverName(nameSource)]
      : [null];
  return names.map((name, offset) => {
    const issues: string[] = [];
    if (!name) issues.push("Driver name is missing.");
    if (!licenseNumber) issues.push("Driver code/license number is missing.");
    if (!vehicle.vehicleRaw) issues.push("Vehicle model/type is missing.");
    else if (!vehicle.vehicleType) issues.push(`Should ${vehicle.vehicleRaw} be VAN or SEDAN?`);
    return {
      id: createRowId(offset),
      sourceLine: line.slice(0, 500),
      name,
      licenseNumber,
      vehicleRaw: vehicle.vehicleRaw,
      vehicleType: vehicle.vehicleType,
      sourceNotes: notes,
      possibleNames: [],
      duplicateOccurrences: 0,
      state: issues.length > 0 ? "NEEDS_REVIEW" : "NEW",
      issues,
      existing: null,
    };
  });
}

function baseIssues(row: DriverImportRow) {
  const issues: string[] = [];
  if (!row.name) issues.push("Driver name is missing.");
  if (!row.licenseNumber) issues.push("Driver code/license number is missing.");
  if (!row.vehicleType) {
    issues.push(row.vehicleRaw
      ? `Should ${row.vehicleRaw} be VAN or SEDAN?`
      : "Vehicle model/type is missing.");
  }
  return issues;
}

export function analyzeDriverImportRows(
  rows: DriverImportRow[],
  existingDrivers: ExistingDriverImportSnapshot[],
) {
  const analyzed: DriverImportRow[] = rows.map((row) => ({
    ...structuredClone(row),
    issues: baseIssues(row),
    state: baseIssues(row).length > 0 ? "NEEDS_REVIEW" : "NEW",
    existing: null,
  }));
  const byIdentity = new Map<string, DriverImportRow[]>();
  for (const row of analyzed) {
    if (row.name && row.licenseNumber) {
      const nameKey = normalizeDriverIdentity(row.name);
      const identityKey = `${nameKey}\u0000${row.licenseNumber.toUpperCase()}`;
      byIdentity.set(identityKey, [...(byIdentity.get(identityKey) ?? []), row]);
    }
  }
  for (const group of byIdentity.values()) {
    if (group.length <= 1) continue;
    const vehicleTypes = new Set(group.map((row) => row.vehicleType).filter(Boolean));
    if (vehicleTypes.size > 1) {
      for (const row of group) {
        row.state = "CONFLICT";
        row.issues.push("The same driver name and code appear with conflicting vehicle types.");
      }
      continue;
    }
    const canonical = group.find((row) => row.issues.length === 0);
    if (canonical) {
      for (const row of group) {
        if (row !== canonical && row.issues.length === 0 && row.vehicleType === canonical.vehicleType) {
          row.state = "DUPLICATE_IN_IMPORT";
          row.issues.push("Duplicate driver name, code, and vehicle type in this import.");
        }
      }
    }
  }
  for (const row of analyzed) {
    if (row.state === "CONFLICT" || row.state === "DUPLICATE_IN_IMPORT" || row.issues.length > 0) continue;
    const exactMatches = existingDrivers.filter(
      (driver) =>
        driver.licenseNumber.toUpperCase() === row.licenseNumber!.toUpperCase() &&
        normalizeDriverIdentity(driver.name) === normalizeDriverIdentity(row.name!),
    );
    if (exactMatches.length > 1) {
      row.state = "CONFLICT";
      row.issues.push("More than one existing driver has this same name and code.");
      continue;
    }
    if (exactMatches.length === 1) {
      const existing = exactMatches[0];
      row.existing = structuredClone(existing);
      if (existing.vehicleType !== row.vehicleType) {
        row.state = "EXISTING_UPDATE";
        if (existing.status === "INACTIVE") row.issues.push("Existing driver is INACTIVE; status will not change.");
      } else {
        row.state = "EXISTING_MATCH";
        if (existing.status === "INACTIVE") row.issues.push("Existing driver is INACTIVE; status will not change.");
      }
      continue;
    }
    row.state = "NEW";
  }
  return analyzed;
}

export function extractDriverImportRows(input: {
  text: string;
  createRowId(index: number): string;
}) {
  const text = input.text.trim();
  if (!text || text.length > DRIVER_IMPORT_TEXT_MAX_LENGTH) {
    throw new DriverImportInputError("Driver list text is empty or too long.");
  }
  const physicalLines = text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
  const lines: string[] = [];
  for (const line of physicalLines) {
    const vehicle = classifyDriverVehicle(line);
    const license = findLicenseNumber(line, vehicle.matchedText);
    const remaining = cleanNameSource(line, license, vehicle.matchedText);
    if (vehicle.vehicleRaw && !license && !remaining && lines.length > 0) {
      lines[lines.length - 1] = `${lines[lines.length - 1]} ${line}`;
    } else {
      lines.push(line);
    }
  }
  const uniqueSourceLines = new Map<string, { line: string; duplicateOccurrences: number }>();
  let duplicateRowsSkipped = 0;
  for (const line of lines) {
    if (/^(drivers?|lists?|listas?|turno|shift)\s*:?'?$/i.test(line)) continue;
    const key = normalizeSourceLine(line);
    const duplicate = uniqueSourceLines.get(key);
    if (duplicate) {
      duplicate.duplicateOccurrences += 1;
      duplicateRowsSkipped += 1;
      continue;
    }
    uniqueSourceLines.set(key, { line, duplicateOccurrences: 0 });
  }

  const rows: DriverImportRow[] = [];
  const identities = new Map<string, DriverImportRow>();
  for (const source of uniqueSourceLines.values()) {
    const candidates = initialRows(
      source.line,
      (offset) => input.createRowId(rows.length + offset),
    );
    for (const candidate of candidates) {
      candidate.duplicateOccurrences = source.duplicateOccurrences;
      const identityKey = candidate.name && candidate.licenseNumber
        ? `${normalizeDriverIdentity(candidate.name)}\u0000${candidate.licenseNumber.toUpperCase()}`
        : null;
      const duplicate = identityKey ? identities.get(identityKey) : null;
      if (duplicate && duplicate.vehicleType === candidate.vehicleType) {
        duplicate.duplicateOccurrences += 1;
        duplicateRowsSkipped += 1;
        continue;
      }
      if (rows.length >= DRIVER_IMPORT_MAX_ROWS) {
        throw new DriverImportInputError(`Driver imports are limited to ${DRIVER_IMPORT_MAX_ROWS} unique rows.`);
      }
      rows.push(candidate);
      if (identityKey && !identities.has(identityKey)) identities.set(identityKey, candidate);
    }
  }
  if (rows.length === 0) throw new DriverImportInputError("No driver rows were found.");
  return { rows, duplicateRowsSkipped };
}

export function driverImportLookup(rows: DriverImportRow[]) {
  return {
    licenseNumbers: [...new Set(rows.map((row) => row.licenseNumber).filter((value): value is string => Boolean(value)))],
    names: [...new Set(rows.map((row) => row.name).filter((value): value is string => Boolean(value)))],
  };
}

function blockingRows(rows: DriverImportRow[]) {
  return rows.filter((row) => row.state === "NEEDS_REVIEW" || row.state === "CONFLICT");
}

function questionForRows(rows: DriverImportRow[]) {
  const blockers = blockingRows(rows);
  if (blockers.length === 0) return "Review the cleaned driver list. Is it complete and correct?";
  const questions = blockers.slice(0, 8).map((row) => {
    const reference = row.licenseNumber ? `Code ${row.licenseNumber}` : row.possibleNames[0] || row.name || "Unidentified row";
    return `• ${reference}: ${row.issues[0]}`;
  });
  return `I cleaned ${rows.length} unique entries. I need clarification on ${blockers.length}:\n${questions.join("\n")}${blockers.length > questions.length ? `\n• ${blockers.length - questions.length} more review items remain.` : ""}`;
}

export function toPublicDriverImportDraft(draft: DriverImportDraftRecord): DriverImportDraftPublic {
  const counts = {
    NEW: 0,
    EXISTING_MATCH: 0,
    EXISTING_UPDATE: 0,
    DUPLICATE_IN_IMPORT: draft.duplicateRowsSkipped,
    NEEDS_REVIEW: 0,
    CONFLICT: 0,
  } satisfies Record<DriverImportRowState, number>;
  for (const row of draft.rows) counts[row.state] += 1;
  const blockingCount = counts.NEEDS_REVIEW + counts.CONFLICT;
  return {
    id: draft.id,
    revision: draft.revision,
    counts,
    duplicateRowsSkipped: counts.DUPLICATE_IN_IMPORT,
    blockingCount,
    completeConfirmed: draft.completeConfirmed,
    readyToPrepare: blockingCount === 0 && draft.completeConfirmed,
    question: blockingCount === 0 && draft.completeConfirmed
      ? "The driver import is complete and ready for a confirmation preview."
      : questionForRows(draft.rows),
    rows: draft.rows.map(({ sourceLine, existing, ...row }) => {
      void sourceLine;
      return {
        ...structuredClone(row),
        existing: existing
          ? {
              id: existing.id,
              name: existing.name,
              licenseNumber: existing.licenseNumber,
              vehicleType: existing.vehicleType,
              status: existing.status,
            }
          : null,
      };
    }),
  };
}

export async function createDriverImportDraft(input: {
  id: string;
  ownerUserId: string;
  ownerEmail: string;
  text: string;
  createRowId(index: number): string;
  repository: DriverImportExistingRepository;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const extracted = extractDriverImportRows({ text: input.text, createRowId: input.createRowId });
  const existing = await input.repository.findCandidates(driverImportLookup(extracted.rows));
  const rows = analyzeDriverImportRows(extracted.rows, existing);
  return {
    id: input.id,
    ownerUserId: input.ownerUserId,
    ownerEmail: input.ownerEmail.trim().toLowerCase(),
    revision: 1,
    rows,
    duplicateRowsSkipped: extracted.duplicateRowsSkipped,
    completeConfirmed: false,
    pendingActionId: null,
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(now.getTime() + DRIVER_IMPORT_TTL_MS),
  } satisfies DriverImportDraftRecord;
}

export async function updateDriverImportDraft(
  draft: DriverImportDraftRecord,
  input: DriverImportDraftUpdateArguments,
  repository: DriverImportExistingRepository,
  now = new Date(),
) {
  if (input.rows.length > 20) throw new DriverImportInputError("Too many driver corrections at once.");
  const rows = structuredClone(draft.rows);
  const seen = new Set<string>();
  let changed = false;
  for (const correction of input.rows) {
    if (seen.has(correction.row_id)) throw new DriverImportInputError("A driver row was corrected more than once.");
    seen.add(correction.row_id);
    const row = rows.find((candidate) => candidate.id === correction.row_id);
    if (!row) throw new DriverImportInputError("Driver import row was not found.");
    if (correction.name !== null) {
      row.name = normalizeDriverName(correction.name);
      row.possibleNames = [];
      changed = true;
    }
    if (correction.license_number !== null) {
      row.licenseNumber = normalizeDriverLicenseNumber(correction.license_number);
      changed = true;
    }
    if (correction.vehicle_type !== null) {
      row.vehicleType = normalizeDriverVehicleType(correction.vehicle_type);
      changed = true;
    }
  }
  const existing = await repository.findCandidates(driverImportLookup(rows));
  const analyzed = analyzeDriverImportRows(rows, existing);
  const blockers = blockingRows(analyzed);
  return {
    ...draft,
    revision: draft.revision + 1,
    rows: analyzed,
    completeConfirmed: input.confirm_complete && blockers.length === 0,
    pendingActionId: changed ? null : draft.pendingActionId,
    updatedAt: now,
    expiresAt: new Date(now.getTime() + DRIVER_IMPORT_TTL_MS),
  } satisfies DriverImportDraftRecord;
}
