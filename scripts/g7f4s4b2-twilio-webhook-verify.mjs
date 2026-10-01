/**
 * G7F-4S4B2 Twilio webhook trust boundary — offline verification.
 *
 * Exercises the real canonical validator (src/lib/twilio-webhook.server.ts), the real recording
 * URL validator / credentialed fetch (src/lib/twilio-recording-url.server.ts), the real
 * downloadTwilioRecording, and the real route modules for every Twilio webhook route.
 *
 * Synthetic only: no network (global fetch is replaced and every call is recorded), no Twilio,
 * no staging, no production, no real credentials (auth token and account SID are generated at
 * runtime and never printed), no customer data, no phone numbers.
 * Stubbed (not under test): the Supabase service-role client (in-memory), telephony routing /
 * voicemail / recording side-effect helpers (call recorders), AI transcription, and
 * isTwilioLiveDeliveryAllowed.
 *
 * Run: npm exec --yes --package=tsx -- tsx scripts/g7f4s4b2-twilio-webhook-verify.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { register } from "node:module";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import twilio from "twilio";

for (const k of [
  "SUPABASE_URL",
  "VITE_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "APP_BASE_URL",
]) {
  delete process.env[k];
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
let total = 0;
function ok(name, cond, detail = "") {
  total += 1;
  if (cond) console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
    failures.push(name);
  }
}
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const read = (rel) => readFileSync(resolve(root, rel), "utf8");
const code = (rel) => strip(read(rel));
const fileUrl = (rel) => pathToFileURL(resolve(root, rel)).href;

// --- synthetic environment (values never printed) ------------------------------------------
const AUTH_TOKEN = randomBytes(16).toString("hex");
const ACCOUNT_SID = `AC${randomBytes(16).toString("hex")}`;
const PUBLIC_BASE = "https://hooks.synthetic.example";
process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
process.env.TWILIO_ACCOUNT_SID = ACCOUNT_SID;
process.env.APP_BASE_URL = PUBLIC_BASE;
process.env.TWILIO_VOICE_PHONE_NUMBER = "+SYNTHETIC-CALLER-ID";
process.env.TWILIO_MESSAGING_SERVICE_SID = "MGsynthetic";

const CALL_ID = randomUUID();
const CALL_SID = `CA${randomBytes(16).toString("hex")}`;
const PARENT_SID = `CA${randomBytes(16).toString("hex")}`;
const RECORDING_SID = `RE${randomBytes(16).toString("hex")}`;
const CUSTOMER_MARKER = "+SYNTHETIC-CUSTOMER-NUMBER";
const RECORDING_URL = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Recordings/${RECORDING_SID}`;

// --- module stubs -----------------------------------------------------------------------------
const routerStub = `
export const createFileRoute = (path) => (options) => ({ path, options });
`;
const clientStub = `
const db = () => globalThis.__s4b2Db;
export const supabaseAdmin = new Proxy({}, { get: (_t, p) => { const v = db()[p]; return typeof v === "function" ? v.bind(db()) : v; } });
export const supabaseAdminUntyped = supabaseAdmin;
`;
const spy = (name) =>
  `export async function ${name}(...args) { globalThis.__s4b2Calls.push({ fn: ${JSON.stringify(name)}, args }); return globalThis.__s4b2Returns[${JSON.stringify(name)}]?.(...args); }`;
const routingStub = [
  "handleAmdStatusCallback",
  "buildInboundTwiml",
  "buildDialDoneTwiml",
  "voicemailResponseTwiml",
]
  .map(spy)
  .join("\n");
const recordingStub = [
  "findPhoneCallId",
  "processPhoneCallRecording",
  "syncRecordingFromTwilioCall",
]
  .map(spy)
  .join("\n");
const voicemailStub = ["handleInboundVoicemailWebhook", "upsertInboundVoicemail"]
  .map(spy)
  .join("\n");
const aiGatewayStub = spy("chatCompletion");
const openaiStub = spy("transcribeAudio");
const appEnvReal = fileUrl("src/lib/app-environment.server.ts");
const appEnvStub = `
export * from ${JSON.stringify(appEnvReal)};
export function isTwilioLiveDeliveryAllowed() { return globalThis.__s4b2Live === true; }
`;

const dataUrl = (src) => `data:text/javascript,${encodeURIComponent(src)}`;
const stubs = { "@tanstack/react-router": dataUrl(routerStub) };
for (const [alias, rel, src] of [
  [
    "@/integrations/supabase/client.server",
    "src/integrations/supabase/client.server.ts",
    clientStub,
  ],
  ["@/lib/telephony-routing.server", "src/lib/telephony-routing.server.ts", routingStub],
  ["@/lib/phone-call-recording.server", "src/lib/phone-call-recording.server.ts", recordingStub],
  ["@/lib/inbound-voicemail.server", "src/lib/inbound-voicemail.server.ts", voicemailStub],
  ["@/lib/ai-gateway.server", "src/lib/ai-gateway.server.ts", aiGatewayStub],
  ["@/lib/openai.server", "src/lib/openai.server.ts", openaiStub],
  ["@/lib/app-environment.server", "src/lib/app-environment.server.ts", appEnvStub],
]) {
  stubs[alias] = dataUrl(src);
  stubs[fileUrl(rel)] = stubs[alias];
}
register(
  dataUrl(`
const stubs = ${JSON.stringify(stubs)};
export async function resolve(specifier, context, next) {
  if (specifier.startsWith("real:")) return next(specifier.slice(5), context);
  if (stubs[specifier] && !String(context.parentURL ?? "").startsWith("data:")) {
    return { url: stubs[specifier], shortCircuit: true };
  }
  return next(specifier, context);
}
`),
  import.meta.url,
);

// --- in-memory service-role client ----------------------------------------------------------
function makeDb() {
  const log = [];
  const tables = {
    phone_calls: [
      { id: CALL_ID, to_number: CUSTOMER_MARKER, ai_status: "pending", recording_url: null },
    ],
  };
  class Query {
    constructor(table) {
      this.table = table;
      this.op = "select";
      this.filters = [];
      this.payload = null;
    }
    select() {
      return this;
    }
    insert(p) {
      this.op = "insert";
      this.payload = p;
      log.push({ op: "insert", table: this.table, payload: p });
      return this;
    }
    update(p) {
      this.op = "update";
      this.payload = p;
      return this;
    }
    eq(c, v) {
      this.filters.push([c, v]);
      return this;
    }
    order() {
      return this;
    }
    limit() {
      return this;
    }
    ilike() {
      return this;
    }
    maybeSingle() {
      return this.exec(true);
    }
    single() {
      return this.exec(true);
    }
    then(res, rej) {
      return this.exec(false).then(res, rej);
    }
    async exec(single) {
      if (this.op === "update") {
        log.push({ op: "update", table: this.table, payload: this.payload, filters: this.filters });
        return { data: null, error: null };
      }
      if (this.op === "insert") return { data: single ? { id: randomUUID() } : null, error: null };
      log.push({ op: "select", table: this.table, filters: this.filters });
      const rows = (tables[this.table] ?? []).filter((r) =>
        this.filters.every(([c, v]) => r[c] === v),
      );
      return { data: single ? (rows[0] ?? null) : rows, error: null };
    }
  }
  return { log, tables, from: (t) => new Query(t) };
}

// --- network capture: every fetch is recorded; nothing leaves the process ---------------------
const fetchLog = [];
const allFetches = [];
let fetchScript = () => new Response("unscripted", { status: 599 });
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  const headers = new Headers(init.headers ?? {});
  const entry = {
    url,
    authorization: headers.get("authorization"),
    redirect: init.redirect ?? "follow",
  };
  fetchLog.push(entry);
  allFetches.push(entry);
  return fetchScript(url, init);
};
const listSource = (dir) =>
  readdirSync(resolve(root, dir)).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(resolve(root, p)).isDirectory()) return listSource(p);
    return /\.(ts|tsx)$/.test(p) ? [p] : [];
  });

function reset() {
  globalThis.__s4b2Db = makeDb();
  globalThis.__s4b2Calls = [];
  globalThis.__s4b2Returns = {
    buildInboundTwiml: () => "<Response><Say>synthetic-inbound</Say></Response>",
    buildDialDoneTwiml: () => "<Response><Say>synthetic-dial-done</Say></Response>",
    voicemailResponseTwiml: () => "<Response><Say>synthetic-vm</Say></Response>",
    findPhoneCallId: () => CALL_ID,
    syncRecordingFromTwilioCall: () => false,
    upsertInboundVoicemail: () => ({ callId: CALL_ID, matched: false, unallocated: true }),
  };
  globalThis.__s4b2Live = false;
  fetchLog.length = 0;
  fetchScript = () => new Response("unscripted", { status: 599 });
}
const calls = (fn) => globalThis.__s4b2Calls.filter((c) => c.fn === fn);
const mutations = () => globalThis.__s4b2Db.log.filter((e) => e.op !== "select");

// --- request builders ----------------------------------------------------------------------
// The internal request URL deliberately differs from the public base (Azure reverse proxy).
const INTERNAL_BASE = "http://10.11.12.13:8080";
function sign(url, params) {
  return twilio.getExpectedTwilioSignature(AUTH_TOKEN, url, params);
}
function twilioRequest(pathAndQuery, params, opts = {}) {
  const method = opts.method ?? "POST";
  const headers = {
    "x-forwarded-host": "attacker.example",
    "x-forwarded-proto": "http",
    origin: "https://attacker.example",
    ...(opts.headers ?? {}),
  };
  if (method === "POST")
    headers["content-type"] = opts.contentType ?? "application/x-www-form-urlencoded";
  const signedUrl = opts.signedUrl ?? `${PUBLIC_BASE}${pathAndQuery}`;
  const signedParams = opts.signedParams ?? (method === "POST" ? params : {});
  if (opts.signature !== undefined) {
    if (opts.signature !== null) headers["x-twilio-signature"] = opts.signature;
  } else {
    headers["x-twilio-signature"] = sign(signedUrl, signedParams);
  }
  const body =
    method === "POST"
      ? (opts.rawBody ?? new URLSearchParams(opts.bodyParams ?? params).toString())
      : undefined;
  return new Request(`${INTERNAL_BASE}${pathAndQuery}`, { method, headers, body });
}

// --- modules under test ------------------------------------------------------------------------
const webhook = await import("../src/lib/twilio-webhook.server.ts");
const recUrl = await import("../src/lib/twilio-recording-url.server.ts");
const callAi = await import("../src/lib/call-ai.server.ts");
const realRecording = await import(`real:${fileUrl("src/lib/phone-call-recording.server.ts")}`);

const ROUTE_FILES = {
  "/api/twilio/voice/amd-status": "src/routes/api/twilio/voice/amd-status.ts",
  "/api/twilio/voice/client-outbound": "src/routes/api/twilio/voice/client-outbound.ts",
  "/api/twilio/voice/inbound": "src/routes/api/twilio/voice/inbound.ts",
  "/api/twilio/voice/inbound-dial-done": "src/routes/api/twilio/voice/inbound-dial-done.ts",
  "/api/twilio/voice/recording": "src/routes/api/twilio/voice/recording.ts",
  "/api/twilio/voice/status": "src/routes/api/twilio/voice/status.ts",
  "/api/twilio/voice/voicemail-done": "src/routes/api/twilio/voice/voicemail-done.ts",
  "/api/sms/inbound": "src/routes/api/sms/inbound.ts",
};
const routes = {};
for (const [path, rel] of Object.entries(ROUTE_FILES)) {
  routes[path] = (await import(`../${rel}`)).Route.options.server.handlers;
}

// --- TEST 1-5: canonical validator ------------------------------------------------------------
const statusPath = `/api/twilio/voice/status?callId=${CALL_ID}`;
const statusParams = { CallSid: CALL_SID, CallStatus: "completed", CallDuration: "42" };

reset();
{
  const r1 = await webhook.verifyTwilioWebhook(
    twilioRequest(statusPath, statusParams, { signature: null }),
  );
  const res = await routes["/api/twilio/voice/status"].POST({
    request: twilioRequest(statusPath, statusParams, { signature: null }),
  });
  ok(
    "TEST_1 missing X-Twilio-Signature rejected",
    !r1.ok && res.status === 403 && mutations().length === 0,
  );
}
reset();
{
  const bogus = Buffer.from(randomBytes(20)).toString("base64");
  const r = await webhook.verifyTwilioWebhook(
    twilioRequest(statusPath, statusParams, { signature: bogus }),
  );
  const empty = await webhook.verifyTwilioWebhook(
    twilioRequest(statusPath, statusParams, { signature: "" }),
  );
  ok("TEST_2 invalid signature rejected", !r.ok && !empty.ok && r.response.status === 403);
}
reset();
{
  const r = await webhook.verifyTwilioWebhook(twilioRequest(statusPath, statusParams));
  ok(
    "TEST_3 correct synthetic signature accepted",
    r.ok && r.params.get("CallSid") === CALL_SID && r.params.get("CallStatus") === "completed",
  );
}
reset();
{
  const altered = await webhook.verifyTwilioWebhook(
    twilioRequest(statusPath, statusParams, {
      bodyParams: { ...statusParams, CallStatus: "failed" },
    }),
  );
  const extra = await webhook.verifyTwilioWebhook(
    twilioRequest(statusPath, statusParams, { bodyParams: { ...statusParams, Injected: "1" } }),
  );
  const query = await webhook.verifyTwilioWebhook(
    twilioRequest(`/api/twilio/voice/status?callId=${randomUUID()}`, statusParams, {
      signedUrl: `${PUBLIC_BASE}${statusPath}`,
    }),
  );
  ok("TEST_4 valid signature over altered body rejected", !altered.ok && !extra.ok && !query.ok);
}
reset();
{
  const otherPath = await webhook.verifyTwilioWebhook(
    twilioRequest(statusPath, statusParams, {
      signedUrl: `${PUBLIC_BASE}/api/twilio/voice/recording`,
    }),
  );
  const spoofHost = await webhook.verifyTwilioWebhook(
    twilioRequest(statusPath, statusParams, {
      signedUrl: `https://attacker.example${statusPath}`,
      headers: { "x-forwarded-host": "attacker.example", "x-forwarded-proto": "https" },
    }),
  );
  const internalUrl = await webhook.verifyTwilioWebhook(
    twilioRequest(statusPath, statusParams, { signedUrl: `${INTERNAL_BASE}${statusPath}` }),
  );
  ok(
    "TEST_5 valid signature for different URL rejected (path, spoofed forwarded host, internal URL)",
    !otherPath.ok && !spoofHost.ok && !internalUrl.ok,
  );
}

// Fail-closed configuration and content handling.
reset();
{
  delete process.env.TWILIO_AUTH_TOKEN;
  const noToken = await webhook.verifyTwilioWebhook(twilioRequest(statusPath, statusParams));
  process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
  delete process.env.APP_BASE_URL;
  const noBase = await webhook.verifyTwilioWebhook(twilioRequest(statusPath, statusParams));
  process.env.APP_BASE_URL = PUBLIC_BASE;
  const json = await webhook.verifyTwilioWebhook(
    twilioRequest(statusPath, {}, { contentType: "application/json", rawBody: '{"CallSid":"x"}' }),
  );
  const huge = await webhook.verifyTwilioWebhook(
    twilioRequest(statusPath, { Body: "x".repeat(70 * 1024) }),
  );
  const res = await routes["/api/twilio/voice/status"].POST({
    request: twilioRequest(statusPath, statusParams, { signature: "invalid" }),
  });
  const text = await res.text();
  ok(
    "TEST_5b fail closed: no auth token, no APP_BASE_URL, non-form body, oversized body; generic 403",
    !noToken.ok && !noBase.ok && !json.ok && !huge.ok && res.status === 403 && text === "Forbidden",
  );
}

// --- TEST 6-10: unauthenticated route effects ------------------------------------------------
reset();
{
  const amdParams = { CallSid: CALL_SID, ParentCallSid: PARENT_SID, AnsweredBy: "machine_start" };
  const post = await routes["/api/twilio/voice/amd-status"].POST({
    request: twilioRequest("/api/twilio/voice/amd-status", amdParams, { signature: null }),
  });
  const get = await routes["/api/twilio/voice/amd-status"].GET({
    request: twilioRequest(
      `/api/twilio/voice/amd-status?${new URLSearchParams(amdParams)}`,
      {},
      { method: "GET", signature: "forged" },
    ),
  });
  ok(
    "TEST_6 unauthenticated request cannot invoke AMD live-call action",
    post.status === 403 && get.status === 403 && calls("handleAmdStatusCallback").length === 0,
  );
}
reset();
{
  const res = await routes["/api/twilio/voice/status"].POST({
    request: twilioRequest(statusPath, statusParams, { signature: null }),
  });
  ok(
    "TEST_7 unauthenticated request cannot alter call status",
    res.status === 403 &&
      mutations().length === 0 &&
      calls("syncRecordingFromTwilioCall").length === 0,
  );
}
reset();
{
  const res = await routes["/api/sms/inbound"].POST({
    request: twilioRequest(
      "/api/sms/inbound",
      { From: "+SYNTHETIC-FROM", To: "+SYNTHETIC-TO", Body: "BOOK", MessageSid: "SMsynthetic" },
      { signature: null },
    ),
  });
  ok(
    "TEST_8 unauthenticated request cannot forge inbound SMS",
    res.status === 403 && mutations().length === 0,
  );
}
reset();
{
  globalThis.__s4b2Live = true;
  const res = await routes["/api/twilio/voice/client-outbound"].POST({
    request: twilioRequest(
      "/api/twilio/voice/client-outbound",
      { CallId: CALL_ID },
      { signature: "forged" },
    ),
  });
  const body = await res.text();
  ok(
    "TEST_9 unauthenticated request cannot retrieve client-outbound customer data",
    res.status === 403 && !body.includes(CUSTOMER_MARKER) && globalThis.__s4b2Db.log.length === 0,
  );
}
reset();
{
  const attackerUrl = "https://attacker.example/steal";
  const rec = await routes["/api/twilio/voice/recording"].POST({
    request: twilioRequest(
      `/api/twilio/voice/recording?callId=${CALL_ID}`,
      {
        RecordingUrl: attackerUrl,
        RecordingSid: RECORDING_SID,
        CallSid: CALL_SID,
        From: "client:x",
        RecordingStatus: "completed",
      },
      { signature: null },
    ),
  });
  const vm = await routes["/api/twilio/voice/voicemail-done"].POST({
    request: twilioRequest(
      "/api/twilio/voice/voicemail-done",
      { RecordingUrl: attackerUrl, CallSid: CALL_SID, From: "+SYNTHETIC-FROM" },
      { signature: "forged" },
    ),
  });
  ok(
    "TEST_10 unauthenticated request cannot trigger recording fetch (recording, voicemail-done)",
    rec.status === 403 &&
      vm.status === 403 &&
      fetchLog.length === 0 &&
      globalThis.__s4b2Calls.length === 0 &&
      mutations().length === 0,
  );
}

// --- TEST 11-19: recording URL validator -----------------------------------------------------
const accepts = (u, sid) =>
  recUrl.trustedTwilioRecordingDownloadUrls({
    recordingUrl: u,
    recordingSid: sid,
    accountSid: ACCOUNT_SID,
  });
const recPath = `/2010-04-01/Accounts/${ACCOUNT_SID}/Recordings/${RECORDING_SID}`;
{
  const a = accepts(RECORDING_URL, RECORDING_SID);
  const b = accepts(`${RECORDING_URL}.mp3`);
  ok(
    "TEST_11 https://api.twilio.com recording URL for this account accepted (canonical URLs rebuilt)",
    Array.isArray(a) &&
      a[0] === `${RECORDING_URL}.mp3` &&
      a[1] === `${RECORDING_URL}.mp3?RequestedChannels=dual` &&
      Array.isArray(b),
  );
}
ok("TEST_12 http://api.twilio.com rejected", accepts(`http://api.twilio.com${recPath}`) === null);
ok(
  "TEST_13 localhost rejected",
  accepts(`https://localhost${recPath}`) === null &&
    accepts(`https://twilio.localhost${recPath}`) === null,
);
ok(
  "TEST_14 127.0.0.1 rejected",
  accepts(`https://127.0.0.1${recPath}`) === null &&
    accepts(`https://0x7f000001${recPath}`) === null,
);
ok(
  "TEST_15 private-network URL rejected",
  [
    "https://10.0.0.5",
    "https://192.168.1.10",
    "https://172.16.0.1",
    "https://169.254.169.254",
    "https://[::1]",
    "https://[fd00::1]",
    "https://metadata.internal",
    "https://intranet",
  ].every((h) => accepts(`${h}${recPath}`) === null),
);
ok(
  "TEST_16 api.twilio.com.attacker.example rejected",
  accepts(`https://api.twilio.com.attacker.example${recPath}`) === null &&
    accepts(`https://evilapi.twilio.com${recPath}`) === null &&
    accepts(`https://api.twilio.com.${recPath}`) === null,
);
ok(
  "TEST_17 attacker.example/api.twilio.com rejected",
  accepts(`https://attacker.example/api.twilio.com${recPath}`) === null &&
    accepts(`https://attacker.example${recPath}`) === null,
);
ok(
  "TEST_18 URL containing credentials rejected",
  accepts(`https://user:pass@api.twilio.com${recPath}`) === null &&
    accepts(`https://api.twilio.com@attacker.example${recPath}`) === null,
);
ok(
  "TEST_19 unexpected port rejected",
  accepts(`https://api.twilio.com:8443${recPath}`) === null &&
    accepts(`https://api.twilio.com:80${recPath}`) === null,
);
ok(
  "TEST_19b other account, mismatched RecordingSid, query, fragment, traversal, malformed rejected",
  accepts(
    `https://api.twilio.com/2010-04-01/Accounts/AC${"0".repeat(32)}/Recordings/${RECORDING_SID}`,
  ) === null &&
    accepts(RECORDING_URL, `RE${"1".repeat(32)}`) === null &&
    accepts(`${RECORDING_URL}?x=1`) === null &&
    accepts(`${RECORDING_URL}#x`) === null &&
    accepts(`https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Recordings/../Messages`) ===
      null &&
    accepts("not a url") === null &&
    accepts("") === null &&
    accepts(` ${RECORDING_URL}`) === null,
);

// --- TEST 20-21: redirects and credential attachment ----------------------------------------
const AUTH_HEADER = `Basic ${Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString("base64")}`;
reset();
{
  const redirectTo = (loc) => new Response(null, { status: 302, headers: { location: loc } });
  fetchScript = (url) => {
    if (url.startsWith("https://api.twilio.com/"))
      return redirectTo("https://attacker.example/collect");
    if (url.startsWith("https://attacker.example/")) return new Response("audio", { status: 200 });
    return new Response("unexpected", { status: 599 });
  };
  const res = await recUrl.fetchWithTwilioCredentials(`${RECORDING_URL}.mp3`, AUTH_HEADER);
  const attackerHop = fetchLog.find((f) => f.url.startsWith("https://attacker.example/"));
  const firstHop = fetchLog[0];

  fetchLog.length = 0;
  let hop = 0;
  fetchScript = () => {
    hop += 1;
    return hop === 1
      ? redirectTo("http://api.twilio.com/plain")
      : new Response("x", { status: 200 });
  };
  const toHttp = await recUrl.fetchWithTwilioCredentials(`${RECORDING_URL}.mp3`, AUTH_HEADER);
  const httpHops = fetchLog.length;

  fetchLog.length = 0;
  hop = 0;
  fetchScript = () => {
    hop += 1;
    return hop === 1
      ? redirectTo("https://169.254.169.254/latest")
      : new Response("x", { status: 200 });
  };
  const toPrivate = await recUrl.fetchWithTwilioCredentials(`${RECORDING_URL}.mp3`, AUTH_HEADER);
  const privateHops = fetchLog.length;

  fetchLog.length = 0;
  fetchScript = (url) =>
    url.endsWith(".mp3") && !url.includes("dual")
      ? redirectTo(`https://api.twilio.com${recPath}.mp3?RequestedChannels=dual`)
      : new Response("audio", { status: 200 });
  const twilioToTwilio = await recUrl.fetchWithTwilioCredentials(
    `${RECORDING_URL}.mp3`,
    AUTH_HEADER,
  );
  const bothCredentialed =
    fetchLog.length === 2 && fetchLog.every((f) => f.authorization === AUTH_HEADER);

  fetchLog.length = 0;
  fetchScript = () => redirectTo("https://api.twilio.com/loop");
  const loop = await recUrl.fetchWithTwilioCredentials(`${RECORDING_URL}.mp3`, AUTH_HEADER);

  ok(
    "TEST_20 redirect to untrusted host cannot receive credentials",
    firstHop?.authorization === AUTH_HEADER &&
      firstHop?.redirect === "manual" &&
      attackerHop &&
      attackerHop.authorization === null &&
      res?.status === 200 &&
      toHttp === null &&
      httpHops === 1 &&
      toPrivate === null &&
      privateHops === 1 &&
      twilioToTwilio?.status === 200 &&
      bothCredentialed &&
      loop === null &&
      fetchLog.length === 4,
  );
}
reset();
{
  const outcomes = [];
  for (const bad of [
    "https://attacker.example/steal",
    `https://api.twilio.com.attacker.example${recPath}`,
    `http://api.twilio.com${recPath}`,
    `https://127.0.0.1${recPath}`,
  ]) {
    try {
      await callAi.downloadTwilioRecording(bad, RECORDING_SID);
      outcomes.push("downloaded");
    } catch (e) {
      outcomes.push(String(e?.message ?? e));
    }
  }
  const directRejected = await recUrl.fetchWithTwilioCredentials(
    "https://attacker.example/x",
    AUTH_HEADER,
  );
  const rejectedBeforeFetch = fetchLog.length === 0 && directRejected === null;

  fetchScript = (url) =>
    url.startsWith("https://api.twilio.com/")
      ? new Response("audio", { status: 200 })
      : new Response("", { status: 599 });
  const blob = await callAi.downloadTwilioRecording(RECORDING_URL, RECORDING_SID);
  const goodFetch = fetchLog.length === 1 && fetchLog[0].url === `${RECORDING_URL}.mp3`;

  const callAiSrc = code("src/lib/call-ai.server.ts");
  ok(
    "TEST_21 Twilio credentials never attached before destination validation",
    outcomes.every((o) => o === "Recording URL rejected.") &&
      rejectedBeforeFetch &&
      blob instanceof Blob &&
      goodFetch &&
      !/\bfetch\(/.test(callAiSrc) &&
      /trustedTwilioRecordingDownloadUrls\(/.test(callAiSrc) &&
      /fetchWithTwilioCredentials\(/.test(callAiSrc),
  );
}

// --- TEST 22: every inventoried Twilio webhook route uses the canonical validator -------------
{
  const found = [
    ...listSource("src/routes/api/twilio"),
    ...listSource("src/routes/api/sms"),
  ].sort();
  const expected = [
    ...Object.values(ROUTE_FILES),
    "src/routes/api/twilio/voice/susan-prompt.ts",
  ].sort();
  const inventoryMatches = JSON.stringify(found) === JSON.stringify(expected);

  const perRoute = Object.entries(ROUTE_FILES).map(([path, rel]) => {
    const src = code(rel);
    const handlerKeys = Object.keys(routes[path]);
    const wrapped = (src.match(/\b(GET|POST|PUT|PATCH|DELETE):\s*withTwilioSignature\(/g) ?? [])
      .length;
    return {
      rel,
      ok:
        /from "@\/lib\/twilio-webhook\.server"/.test(src) &&
        wrapped === handlerKeys.length &&
        handlerKeys.length > 0 &&
        !/request\.(formData|text|json|arrayBuffer|blob)\(/.test(src),
    };
  });
  const susan = code("src/routes/api/twilio/voice/susan-prompt.ts");

  const srcFiles = listSource("src");
  const validatorUsers = srcFiles.filter((f) => /validateRequest(WithBody)?\s*\(/.test(code(f)));
  const hmacSha1 = srcFiles.filter((f) => /createHmac\(\s*["']sha1["']/.test(code(f)));

  reset();
  let all403 = true;
  for (const [path, handlers] of Object.entries(routes)) {
    for (const [method, handler] of Object.entries(handlers)) {
      const req =
        method === "GET"
          ? twilioRequest(`${path}?CallSid=${CALL_SID}`, {}, { method: "GET", signature: null })
          : twilioRequest(
              path,
              { CallSid: CALL_SID, From: "client:x", RecordingUrl: RECORDING_URL },
              { signature: null },
            );
      const res = await handler({ request: req });
      if (res.status !== 403) all403 = false;
    }
  }
  ok(
    "TEST_22 all Twilio webhook routes use the canonical validator",
    inventoryMatches &&
      perRoute.every((r) => r.ok) &&
      all403 &&
      globalThis.__s4b2Calls.length === 0 &&
      globalThis.__s4b2Db.log.length === 0 &&
      /verifySusanPromptSig\(/.test(susan) &&
      validatorUsers.length === 1 &&
      validatorUsers[0] === "src/lib/twilio-webhook.server.ts" &&
      hmacSha1.length === 0,
    `${Object.keys(ROUTE_FILES).length} routes; susan-prompt keeps its signed-URL check`,
  );
}

// --- TEST 23: no alternate caller-controlled recording fetch path ----------------------------
{
  const srcFiles = listSource("src");
  const basicAuthFiles = srcFiles.filter((f) => /Basic \$\{/.test(code(f))).sort();
  const expectedBasic = [
    "src/lib/call-ai.server.ts",
    "src/lib/phone-call-recording.server.ts",
    "src/lib/sms.server.ts",
  ];
  const sms = code("src/lib/sms.server.ts");
  const pcr = code("src/lib/phone-call-recording.server.ts");
  const fixedHosts =
    /fetch\(`https:\/\/api\.twilio\.com\/2010-04-01\/Accounts\/\$\{accountSid\}\/Messages\.json`/.test(
      sms,
    ) &&
    /fetch\(`https:\/\/api\.twilio\.com\/2010-04-01\/Accounts\/\$\{accountSid\}\$\{path\}`/.test(
      pcr,
    );
  const recordingUrlReaders = srcFiles.filter((f) => /["']RecordingUrl["']/.test(code(f))).sort();
  const downloadDefs = srcFiles.filter((f) => /function downloadTwilioRecording\b/.test(code(f)));

  reset();
  const traversal = await realRecording.syncRecordingFromTwilioCall("../../Messages", CALL_ID);
  const badSid = await realRecording.syncRecordingFromTwilioCall("CAnot-a-sid", CALL_ID);
  const noFetch = fetchLog.length === 0;

  reset();
  fetchScript = () =>
    new Response(
      JSON.stringify({ recordings: [{ sid: "../../../evil", status: "completed", uri: "/x" }] }),
      {
        status: 200,
      },
    );
  const badRecordingSid = await realRecording.syncRecordingFromTwilioCall(CALL_SID, CALL_ID);
  const onlyListFetched =
    fetchLog.length === 1 &&
    fetchLog[0].url ===
      `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Calls/${CALL_SID}/Recordings.json`;

  ok(
    "TEST_23 no alternate caller-controlled recording fetch path remains",
    JSON.stringify(basicAuthFiles) === JSON.stringify(expectedBasic) &&
      fixedHosts &&
      JSON.stringify(recordingUrlReaders) ===
        JSON.stringify([
          "src/routes/api/twilio/voice/recording.ts",
          "src/routes/api/twilio/voice/voicemail-done.ts",
        ]) &&
      downloadDefs.length === 1 &&
      traversal === false &&
      badSid === false &&
      noFetch &&
      badRecordingSid === false &&
      onlyListFetched,
  );
}

// --- TEST 24: signed synthetic Twilio requests keep their behaviour --------------------------
{
  const results = {};

  reset();
  let res = await routes["/api/twilio/voice/status"].POST({
    request: twilioRequest(statusPath, statusParams),
  });
  const upd = mutations().find((m) => m.op === "update" && m.table === "phone_calls");
  results.status =
    res.status === 200 &&
    upd?.payload.status === "completed" &&
    upd?.payload.twilio_call_sid === CALL_SID &&
    upd?.payload.duration_seconds === 42 &&
    JSON.stringify(upd?.filters) === JSON.stringify([["id", CALL_ID]]) &&
    calls("syncRecordingFromTwilioCall").length === 1;

  reset();
  const amdParams = { CallSid: CALL_SID, ParentCallSid: PARENT_SID, AnsweredBy: "machine_start" };
  res = await routes["/api/twilio/voice/amd-status"].POST({
    request: twilioRequest("/api/twilio/voice/amd-status", amdParams),
  });
  const amdGet = await routes["/api/twilio/voice/amd-status"].GET({
    request: twilioRequest(
      `/api/twilio/voice/amd-status?${new URLSearchParams(amdParams)}`,
      {},
      { method: "GET" },
    ),
  });
  const amd = calls("handleAmdStatusCallback");
  results.amd =
    res.status === 200 &&
    amdGet.status === 200 &&
    amd.length === 2 &&
    amd.every(
      (c) =>
        c.args[0].callSid === CALL_SID &&
        c.args[0].parentCallSid === PARENT_SID &&
        c.args[0].answeredBy === "machine_start",
    );

  reset();
  res = await routes["/api/sms/inbound"].POST({
    request: twilioRequest("/api/sms/inbound", {
      From: "+SYNTHETIC-FROM",
      To: "+SYNTHETIC-TO",
      Body: "BOOK please",
      MessageSid: "SMsynthetic",
    }),
  });
  const smsBody = await res.text();
  const ins = mutations().find((m) => m.op === "insert" && m.table === "sms_messages");
  results.sms =
    res.status === 200 &&
    ins?.payload.body === "BOOK please" &&
    ins?.payload.direction === "inbound" &&
    smsBody.includes("<Message>") &&
    smsBody.includes(`${PUBLIC_BASE}/book`);

  reset();
  globalThis.__s4b2Live = true;
  res = await routes["/api/twilio/voice/client-outbound"].POST({
    request: twilioRequest("/api/twilio/voice/client-outbound", { CallId: CALL_ID }),
  });
  const outboundTwiml = await res.text();
  globalThis.__s4b2Live = false;
  const captureRes = await routes["/api/twilio/voice/client-outbound"].POST({
    request: twilioRequest("/api/twilio/voice/client-outbound", { CallId: CALL_ID }),
  });
  const captureTwiml = await captureRes.text();
  results.clientOutbound =
    res.status === 200 &&
    outboundTwiml.includes(`<Number>${CUSTOMER_MARKER}</Number>`) &&
    outboundTwiml.includes(`${PUBLIC_BASE}/api/twilio/voice/recording?callId=${CALL_ID}`) &&
    captureTwiml.includes("Outbound calling is disabled") &&
    !captureTwiml.includes(CUSTOMER_MARKER);

  reset();
  const recParams = {
    RecordingSid: RECORDING_SID,
    RecordingUrl: RECORDING_URL,
    CallSid: CALL_SID,
    From: "client:synthetic",
    RecordingStatus: "completed",
  };
  res = await routes["/api/twilio/voice/recording"].POST({
    request: twilioRequest(`/api/twilio/voice/recording?callId=${CALL_ID}`, recParams),
  });
  const proc = calls("processPhoneCallRecording");
  results.recording =
    res.status === 200 &&
    proc.length === 1 &&
    proc[0].args[0] === CALL_ID &&
    proc[0].args[1] === RECORDING_URL;

  reset();
  res = await routes["/api/twilio/voice/voicemail-done"].POST({
    request: twilioRequest("/api/twilio/voice/voicemail-done", {
      CallSid: CALL_SID,
      From: "+SYNTHETIC-FROM",
      RecordingUrl: RECORDING_URL,
      RecordingSid: RECORDING_SID,
    }),
  });
  const vm = calls("handleInboundVoicemailWebhook");
  results.voicemail =
    res.status === 200 &&
    vm.length === 1 &&
    vm[0].args[0].recordingUrl === RECORDING_URL &&
    vm[0].args[0].callSid === CALL_SID;

  reset();
  res = await routes["/api/twilio/voice/inbound"].POST({
    request: twilioRequest("/api/twilio/voice/inbound", {
      From: "+SYNTHETIC-FROM",
      CallSid: CALL_SID,
    }),
  });
  results.inbound =
    res.status === 200 &&
    (await res.text()).includes("synthetic-inbound") &&
    calls("buildInboundTwiml")[0]?.args[0] === "+SYNTHETIC-FROM";

  reset();
  const dialPath = "/api/twilio/voice/inbound-dial-done?noAnswer=voicemail&step=after_softphone";
  res = await routes["/api/twilio/voice/inbound-dial-done"].POST({
    request: twilioRequest(dialPath, { DialCallStatus: "no-answer", CallSid: CALL_SID }),
  });
  const dial = calls("buildDialDoneTwiml")[0]?.args[0];
  results.dialDone =
    res.status === 200 &&
    dial?.dialCallStatus === "no-answer" &&
    dial?.noAnswer === "voicemail" &&
    dial?.step === "after_softphone";

  const scripts = [
    "scripts/backfill-call-transcripts.mjs",
    "scripts/backfill-twilio-voicemails.mjs",
  ].every((s) =>
    /"X-Twilio-Signature": twilio\.getExpectedTwilioSignature\(authToken, hookUrl, hookParams\)/.test(
      code(s),
    ),
  );

  const failed = Object.entries(results)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  ok(
    "TEST_24 normal signed synthetic Twilio requests retain expected route behaviour",
    failed.length === 0 && scripts,
    failed.length
      ? `failed: ${failed.join(", ")}`
      : "status, amd, sms, client-outbound, recording, voicemail, inbound, dial-done; operator backfill scripts sign",
  );
}

// --- global: no credential ever left for a non-Twilio host, nothing hit the network ----------
{
  const leaked = allFetches.filter(
    (f) => f.authorization && new URL(f.url).hostname !== "api.twilio.com",
  );
  ok(
    "GLOBAL credentials only ever sent to api.twilio.com in this run",
    allFetches.length > 0 && leaked.length === 0,
    `${allFetches.length} captured fetches, none left the process`,
  );
}

console.log(`\n${total - failures.length}/${total} passed`);
if (failures.length) {
  console.error(`FAILED: ${failures.join(", ")}`);
  process.exit(1);
}
