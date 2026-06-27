// Server-only UK address lookup from a postcode + house number/name.
//
// Provider priority:
//  1. getAddress.io  — full delivery-point addresses (set GETADDRESS_API_KEY).
//     Free tier available; paid for higher volume.
//  2. postcodes.io   — free, no key. Validates the postcode and gives the town
//     /district so we can build a sensible address without the street name.
//  3. manual         — last resort, just "<house>, <postcode>".

export interface ResolvedAddress {
  ok: boolean;
  formatted: string;
  postcode: string;
  provider: "getaddress" | "postcodes.io" | "manual";
  candidates?: string[];
}

const FETCH_TIMEOUT_MS = 6000;

export function normalisePostcode(raw: string): string {
  const compact = (raw ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .trim();
  if (compact.length < 5 || compact.length > 7) return (raw ?? "").trim().toUpperCase();
  return `${compact.slice(0, compact.length - 3)} ${compact.slice(-3)}`;
}

export function isLikelyPostcode(raw: string): boolean {
  return /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i.test(raw ?? "");
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function houseMatches(house: string, candidate: string): boolean {
  const h = house.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!h) return false;
  const c = candidate.toLowerCase();
  // Match a leading house number/name token at the start of the address line.
  const firstToken = c.split(",")[0]?.replace(/[^a-z0-9]/g, "") ?? "";
  return firstToken.startsWith(h) || c.includes(house.toLowerCase());
}

async function viaGetAddress(postcode: string, house: string, key: string): Promise<ResolvedAddress | null> {
  const url = `https://api.getAddress.io/find/${encodeURIComponent(postcode)}?api-key=${encodeURIComponent(key)}&expand=true`;
  const data = (await fetchJson(url)) as
    | { addresses?: Array<Record<string, unknown>> }
    | null;
  if (!data?.addresses?.length) return null;

  const format = (a: Record<string, unknown>): string => {
    const parts = [a.line_1, a.line_2, a.line_3, a.line_4, a.locality, a.town_or_city, a.county]
      .map((p) => (typeof p === "string" ? p.trim() : ""))
      .filter(Boolean);
    return [...new Set(parts), normalisePostcode(postcode)].join(", ");
  };

  const candidates = data.addresses.map(format);
  const match = candidates.find((c) => houseMatches(house, c));
  return {
    ok: Boolean(match),
    formatted: match ?? `${house}, ${candidates[0] ?? normalisePostcode(postcode)}`,
    postcode: normalisePostcode(postcode),
    provider: "getaddress",
    candidates: candidates.slice(0, 8),
  };
}

async function viaPostcodesIo(postcode: string, house: string): Promise<ResolvedAddress | null> {
  const url = `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode.replace(/\s+/g, ""))}`;
  const data = (await fetchJson(url)) as
    | { result?: { postcode?: string; admin_district?: string; parish?: string; region?: string } }
    | null;
  if (!data?.result?.postcode) return null;
  const r = data.result;
  const town = [r.admin_district, r.region].filter(Boolean)[0];
  const formatted = [house, town, r.postcode].filter(Boolean).join(", ");
  return {
    ok: true,
    formatted,
    postcode: r.postcode,
    provider: "postcodes.io",
  };
}

export async function resolveAddress(postcodeRaw: string, houseRaw: string): Promise<ResolvedAddress> {
  const postcode = (postcodeRaw ?? "").trim();
  const house = (houseRaw ?? "").trim();
  const key = process.env.GETADDRESS_API_KEY;

  if (key) {
    const ga = await viaGetAddress(postcode, house, key);
    if (ga) return ga;
  }

  const pio = await viaPostcodesIo(postcode, house);
  if (pio) return pio;

  return {
    ok: false,
    formatted: [house, normalisePostcode(postcode)].filter(Boolean).join(", "),
    postcode: normalisePostcode(postcode),
    provider: "manual",
  };
}
