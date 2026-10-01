// Server-only: recording URLs may only ever receive Twilio credentials on exact Twilio API hosts.

/** Exact hostnames permitted to receive Twilio Basic credentials. No suffix or wildcard matching. */
export const TWILIO_CREDENTIAL_HOSTS: ReadonlySet<string> = new Set(["api.twilio.com"]);

const MAX_URL_LENGTH = 2048;
const MAX_REDIRECTS = 3;
const RECORDING_SID_RE = /^RE[0-9a-f]{32}$/i;
const CALL_SID_RE = /^CA[0-9a-f]{32}$/i;
const RECORDING_PATH_RE =
  /^\/2010-04-01\/Accounts\/(AC[0-9a-f]{32})\/Recordings\/(RE[0-9a-f]{32})(?:\.(?:mp3|wav))?$/i;

export function isTwilioRecordingSid(value: string | null | undefined): value is string {
  return Boolean(value && RECORDING_SID_RE.test(value));
}

export function isTwilioCallSid(value: string | null | undefined): value is string {
  return Boolean(value && CALL_SID_RE.test(value));
}

function isIpLiteral(hostname: string): boolean {
  return hostname.startsWith("[") || hostname.includes(":") || /^[0-9.]+$/.test(hostname);
}

function isInternalHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    !hostname.includes(".")
  );
}

function parseStrictHttpsUrl(raw: string): URL | null {
  if (typeof raw !== "string" || !raw || raw.length > MAX_URL_LENGTH) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f\\]/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.port !== "") return null;
  if (url.hash) return null;
  const hostname = url.hostname.toLowerCase();
  if (!hostname || isIpLiteral(hostname) || isInternalHostname(hostname)) return null;
  return url;
}

function isTwilioCredentialHost(url: URL): boolean {
  return TWILIO_CREDENTIAL_HOSTS.has(url.hostname.toLowerCase());
}

/**
 * Accepts only https://api.twilio.com/2010-04-01/Accounts/{this account}/Recordings/RE… and
 * returns canonical download URLs rebuilt from the validated parts (never the raw input).
 */
export function trustedTwilioRecordingDownloadUrls(opts: {
  recordingUrl: string;
  recordingSid?: string | null;
  accountSid: string;
}): string[] | null {
  const url = parseStrictHttpsUrl(opts.recordingUrl);
  if (!url || !isTwilioCredentialHost(url) || url.search) return null;

  const match = RECORDING_PATH_RE.exec(url.pathname);
  if (!match) return null;
  const [, accountSid, recordingSid] = match;
  if (accountSid !== opts.accountSid) return null;
  if (opts.recordingSid && opts.recordingSid !== recordingSid) return null;

  const base = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${recordingSid}.mp3`;
  return [base, `${base}?RequestedChannels=dual`];
}

/**
 * GET with redirects disabled. Credentials are attached only to hops whose destination is an
 * exact Twilio API host; any other redirect destination (e.g. a pre-signed media URL) is
 * fetched without credentials and only if it is a public https hostname.
 */
export async function fetchWithTwilioCredentials(
  initialUrl: string,
  authorization: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Response | null> {
  let next = parseStrictHttpsUrl(initialUrl);
  if (!next || !isTwilioCredentialHost(next)) return null;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const headers: Record<string, string> = isTwilioCredentialHost(next)
      ? { Authorization: authorization }
      : {};
    const res = await fetchImpl(next.toString(), { headers, redirect: "manual" });
    if (res.status < 300 || res.status >= 400) return res;

    const location = res.headers.get("location");
    if (!location) return null;
    let resolved: string;
    try {
      resolved = new URL(location, next).toString();
    } catch {
      return null;
    }
    next = parseStrictHttpsUrl(resolved);
    if (!next) return null;
  }
  return null;
}
