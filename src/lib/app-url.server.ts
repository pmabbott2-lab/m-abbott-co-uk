/** Server-side canonical app URL for auth emails (not bundled into the client). */
export function getServerAppOrigin(request?: Request): string {
  const fromEnv =
    process.env.VITE_APP_URL?.trim() ||
    process.env.APP_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");

  if (request) {
    const origin = request.headers.get("origin")?.trim();
    if (origin) return origin.replace(/\/$/, "");
    const referer = request.headers.get("referer")?.trim();
    if (referer) {
      try {
        return new URL(referer).origin;
      } catch {
        /* ignore */
      }
    }
  }

  return "http://localhost:8080";
}

export function getServerPasswordResetUrl(request?: Request): string {
  return `${getServerAppOrigin(request)}/auth/reset`;
}
