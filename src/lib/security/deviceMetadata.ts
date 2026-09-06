import { isIP } from "node:net";

export function parseDeviceMetadata(userAgent: string | null | undefined) {
  const ua = (userAgent ?? "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 512);
  const device = /iPhone/i.test(ua) ? "iPhone" : /iPad/i.test(ua) ? "iPad"
    : /Android/i.test(ua) ? "Android" : /Windows/i.test(ua) ? "Windows PC"
    : /Macintosh|Mac OS X/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "Linux device" : "Unknown device";
  const os = /iPhone|iPad|iPod/i.test(ua) ? "iOS" : /Android/i.test(ua) ? "Android"
    : /Windows/i.test(ua) ? "Windows" : /Macintosh|Mac OS X/i.test(ua) ? "macOS"
    : /Linux/i.test(ua) ? "Linux" : "Unknown OS";
  const browser = /Edg(?:e|A|iOS)?\//i.test(ua) ? "Edge" : /OPR\//i.test(ua) ? "Opera"
    : /Firefox\/|FxiOS\//i.test(ua) ? "Firefox" : /Chrome\/|CriOS\//i.test(ua) ? "Chrome"
    : /Safari\//i.test(ua) ? "Safari" : "Unknown browser";
  return { userAgent: ua || null, device, os, browser };
}

type HeaderReader = { get(name: string): string | null };

/** Only Vercel's edge-controlled metadata is trusted. No generic forwarded header fallback. */
export function trustedNetworkMetadata(headers: HeaderReader, onVercel = process.env.VERCEL === "1") {
  const empty = { ipAddress: null, networkCity: null, networkRegion: null, networkCountry: null };
  if (!onVercel) return empty;
  const ip = headers.get("x-vercel-forwarded-for")?.trim() ?? "";
  const label = (name: string) => {
    const raw = headers.get(name);
    if (!raw) return null;
    try { return decodeURIComponent(raw).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80) || null; }
    catch { return null; }
  };
  return {
    ipAddress: isIP(ip) ? ip : null,
    networkCity: label("x-vercel-ip-city"), networkRegion: label("x-vercel-ip-country-region"),
    networkCountry: label("x-vercel-ip-country"),
  };
}
