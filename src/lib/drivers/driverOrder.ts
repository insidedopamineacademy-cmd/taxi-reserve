type DriverIdentity = { id: string; name: string; licenseNumber?: string | null };

// Fixed European/English collation: case and accents do not split names into
// separate groups. Explicit normalized keys and IDs resolve every tie, so a
// database's collation or incoming row order cannot change the result.
const nameCollator = new Intl.Collator("en-GB", { sensitivity: "base", numeric: true });

function normalized(value: string) {
  return value.trim().normalize("NFKD").toLocaleLowerCase("en-GB");
}

function compareKey(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compareDriversByName(left: DriverIdentity, right: DriverIdentity) {
  const a = normalized(left.name);
  const b = normalized(right.name);
  const licenseA = normalized(left.licenseNumber ?? "");
  const licenseB = normalized(right.licenseNumber ?? "");
  return nameCollator.compare(a, b) || compareKey(a, b) ||
    nameCollator.compare(licenseA, licenseB) || compareKey(licenseA, licenseB) ||
    compareKey(left.id, right.id);
}

export function sortDriversByName<T extends DriverIdentity>(drivers: readonly T[]): T[] {
  return [...drivers].sort(compareDriversByName);
}

/** Sort the full candidate set before slicing, never just one database page. */
export function alphabeticalDriverPage<T extends DriverIdentity>(
  drivers: readonly T[], offset: number, limit: number,
) {
  const ordered = sortDriversByName(drivers);
  return { drivers: ordered.slice(offset, offset + limit), hasMore: ordered.length > offset + limit };
}
