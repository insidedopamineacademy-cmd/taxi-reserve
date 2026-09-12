type LoginActivityRecord = { action: string; entityId: string | null; metadata: unknown };

/** Read only known presentation fields; old login rows may lack all metadata. */
export function loginActivityDetails(log: LoginActivityRecord, currentSessionId?: string) {
  if (log.action !== "user_login" && log.action !== "admin_login") return null;
  const metadata = log.metadata && typeof log.metadata === "object" && !Array.isArray(log.metadata)
    ? log.metadata as Record<string, unknown> : {};
  const field = (name: string, limit: number) => typeof metadata[name] === "string"
    ? (metadata[name] as string).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, limit) || null : null;
  const country = field("networkCountry", 80);
  const countryName = country && /^[a-z]{2}$/i.test(country)
    ? new Intl.DisplayNames(["en"], { type: "region" }).of(country.toUpperCase()) : country;
  const sessionId = field("sessionId", 100) ?? log.entityId;
  return {
    label: log.action === "admin_login" ? "ADMIN LOGIN (LEGACY)" : "LOGIN",
    device: [field("device", 40), field("browser", 40), field("os", 40)].filter(Boolean).join(" · ") || "Device details unavailable",
    network: [field("networkCity", 80), field("networkRegion", 80), countryName].filter(Boolean).join(", ") || "Network estimate unavailable",
    ipAddress: field("ipAddress", 45),
    sessionId,
    isCurrentSession: Boolean(currentSessionId && sessionId === currentSessionId),
  };
}
