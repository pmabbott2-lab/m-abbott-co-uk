/** Decode Supabase JWT payload when getClaims() cannot reach Supabase (DNS/network). */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(base64, "base64").toString("utf8");
    const payload = JSON.parse(json) as Record<string, unknown>;
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

export function jwtPayloadUsable(payload: Record<string, unknown> | null): boolean {
  if (!payload?.sub || typeof payload.sub !== "string") return false;
  const exp = payload.exp;
  if (typeof exp !== "number") return false;
  return exp * 1000 > Date.now() - 60_000;
}

export function isNetworkAuthError(error: unknown): boolean {
  const parts: string[] = [];
  if (error instanceof Error) {
    parts.push(error.message);
    const cause = (error as { cause?: { message?: string } }).cause?.message;
    if (cause) parts.push(cause);
  } else if (error && typeof error === "object" && "message" in error) {
    parts.push(String((error as { message: unknown }).message));
  }
  const text = parts.join(" ");
  return /ENOTFOUND|fetch failed|network|ECONNREFUSED|ETIMEDOUT/i.test(text);
}
