import type { AddressObject } from "mailparser";

export function normalizeMessageId(value?: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  const bracketed = trimmed.match(/<[^<>\s]+>/)?.[0];
  return bracketed ?? trimmed;
}

export function normalizeReferenceIds(value?: string | string[] | null) {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  const ids = values.flatMap((item) => {
    const matches = item.match(/<[^<>\s]+>/g);
    return matches?.length ? matches : [item];
  });

  return [...new Set(ids.map((id) => normalizeMessageId(id)).filter(Boolean))] as string[];
}

export function firstAddress(value?: AddressObject | AddressObject[] | null) {
  const object = Array.isArray(value) ? value[0] : value;
  return object?.value[0] ?? null;
}

export function addressList(value?: AddressObject | AddressObject[] | null) {
  const objects = value ? (Array.isArray(value) ? value : [value]) : [];
  return objects
    .flatMap((object) => object.value)
    .map((address) => address.address)
    .filter((address): address is string => Boolean(address))
    .join(", ");
}

export function safeAttachmentName(value?: string) {
  const filename = value?.split(/[\\/]/).pop()?.trim() || "attachment";
  return filename.slice(0, 255);
}
