/**
 * G7F-3C3 Phase-A live driver (STAGING fwgjtbeigpipvayytwlu only, disposable personas only).
 *
 * Holds disposable passwords, TOTP secrets, Auth tokens and recovery grants in process memory only.
 * Never prints them. Hashes that SQL needs (bcrypt password hashes, grant digests) and session ids
 * are handed over through public.g7f3c3_live_handoff (anon INSERT only; no SELECT for API roles).
 * Commands: JSON files in /tmp/g7f3c3-live/cmd/<id>.json → results in /tmp/g7f3c3-live/out/<id>.json.
 * Results contain statuses, AAL, AMR method names and 12-char SHA-256 fingerprints only.
 *
 * Run (background): G7F3C3_SUPABASE_URL=… G7F3C3_PUBLISHABLE_KEY=… G7F3C3_BCRYPT_PATH=…
 *   npm exec --yes --package=tsx -- tsx scripts/g7f3c3-mfa-recovery-live.mjs
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const STAGING_URL = "https://fwgjtbeigpipvayytwlu.supabase.co";
const BASE = (process.env.G7F3C3_SUPABASE_URL ?? "").replace(/\/$/, "");
const KEY = process.env.G7F3C3_PUBLISHABLE_KEY ?? "";
if (BASE !== STAGING_URL) throw new Error("G7F3C3 live driver refuses any project other than staging fwgjtbeigpipvayytwlu");
if (!/^sb_publishable_/.test(KEY)) throw new Error("G7F3C3 live driver needs the staging publishable key");
const bcrypt = createRequire(import.meta.url)(process.env.G7F3C3_BCRYPT_PATH ?? "bcryptjs");
const rec = await import("../src/lib/privileged-mfa-recovery.ts");

const DIR = process.env.G7F3C3_LIVE_DIR ?? "/tmp/g7f3c3-live";
for (const d of [DIR, `${DIR}/cmd`, `${DIR}/out`]) mkdirSync(d, { recursive: true });

const PERSONAS = ["opa", "opb", "tgt", "sa", "mem", "out"];
const email = (label) => {
  if (!PERSONAS.includes(label)) throw new Error(`unknown persona ${label}`);
  return `staging-g7f3c3-${label}@example.test`;
};
const fp = (v) => (v ? createHash("sha256").update(String(v)).digest("hex").slice(0, 12) : null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const people = Object.fromEntries(PERSONAS.map((p) => [p, { password: null, slots: {}, current: null, factors: [] }]));
const grants = {};
let groupTenant = null;

function jwtClaims(token) {
  try {
    return JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString("utf8"));
  } catch {
    return {};
  }
}
function sessionView(slot) {
  const c = jwtClaims(slot?.access);
  const amr = Array.isArray(c.amr) ? c.amr.map((a) => a?.method).filter(Boolean) : [];
  return { aal: c.aal ?? null, amr, sid_fp: fp(c.session_id), ttl_sec: c.exp && c.iat ? c.exp - c.iat : null };
}

async function call(path, { method = "GET", body, token, prefer } = {}) {
  const headers = { apikey: KEY, Authorization: `Bearer ${token ?? KEY}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, range: res.headers.get("content-range") };
}
const errCode = (r) => (r.json && (r.json.error_code || r.json.code || r.json.error)) || null;

async function handoff(label, value) {
  const r = await call("/rest/v1/g7f3c3_live_handoff", { method: "POST", body: { label, value }, prefer: "return=minimal" });
  if (r.status !== 201) throw new Error(`handoff ${label} failed status=${r.status} code=${errCode(r)}`);
}

function b32decode(s) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let val = 0;
  const out = [];
  for (const ch of String(s).replace(/=+$/, "").toUpperCase()) {
    const i = A.indexOf(ch);
    if (i < 0) continue;
    val = (val << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((val >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
function totpAt(secret, step) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", b32decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}
async function freshCode(factor) {
  let step = Math.floor(Date.now() / 30000);
  if (factor.lastStep !== undefined && step <= factor.lastStep) {
    await sleep((factor.lastStep + 1) * 30000 - Date.now() + 250);
    step = Math.floor(Date.now() / 30000);
  }
  factor.lastStep = step;
  return totpAt(factor.secret, step);
}

function slotOf(p, name) {
  const s = p.slots[name ?? p.current];
  if (!s) throw new Error(`no session slot ${name ?? p.current}`);
  return s;
}

async function challengeVerify(p, slot, factor) {
  const ch = await call(`/auth/v1/factors/${factor.id}/challenge`, { method: "POST", body: {}, token: slot.access });
  if (ch.status !== 200) return { challenge_status: ch.status, challenge_code: errCode(ch) };
  const code = await freshCode(factor);
  const v = await call(`/auth/v1/factors/${factor.id}/verify`, {
    method: "POST",
    body: { challenge_id: ch.json.id, code },
    token: slot.access,
  });
  if (v.status === 200 && v.json?.access_token) {
    slot.access = v.json.access_token;
    slot.refresh = v.json.refresh_token;
  }
  return { challenge_status: ch.status, verify_status: v.status, verify_code: v.status === 200 ? null : errCode(v) };
}

const ops = {
  async setup({ labels } = {}) {
    const out = {};
    for (const label of labels ?? PERSONAS) {
      const p = people[label];
      p.password = randomBytes(24).toString("base64url");
      await handoff(`pw_${label}`, bcrypt.hashSync(p.password, 10));
      out[label] = "hash_handed_off";
    }
    return out;
  },
  async login({ label, slot }) {
    const p = people[label];
    const r = await call("/auth/v1/token?grant_type=password", { method: "POST", body: { email: email(label), password: p.password } });
    if (r.status !== 200) return { status: r.status, code: errCode(r) };
    p.slots[slot] = { access: r.json.access_token, refresh: r.json.refresh_token };
    p.current = slot;
    const sid = jwtClaims(r.json.access_token).session_id;
    await handoff(`sid_${label}_${slot}`, sid);
    return { status: r.status, ...sessionView(p.slots[slot]) };
  },
  async enroll({ label }) {
    const p = people[label];
    const slot = slotOf(p);
    const e = await call("/auth/v1/factors", {
      method: "POST",
      body: { factor_type: "totp", friendly_name: `g7f3c3 ${label} ${p.factors.length + 1} ${randomBytes(3).toString("hex")}` },
      token: slot.access,
    });
    if (e.status !== 200) return { enroll_status: e.status, enroll_code: errCode(e) };
    const factor = { id: e.json.id, secret: e.json.totp?.secret };
    p.factors.push(factor);
    const cv = await challengeVerify(p, slot, factor);
    return { enroll_status: e.status, factor_fp: fp(factor.id), factor_index: p.factors.length - 1, ...cv, ...sessionView(slot) };
  },
  async enroll_only({ label }) {
    const p = people[label];
    const slot = slotOf(p);
    const e = await call("/auth/v1/factors", {
      method: "POST",
      body: { factor_type: "totp", friendly_name: `g7f3c3 ${label} ${p.factors.length + 1} ${randomBytes(3).toString("hex")}` },
      token: slot.access,
    });
    if (e.status !== 200) return { enroll_status: e.status, enroll_code: errCode(e) };
    const factor = { id: e.json.id, secret: e.json.totp?.secret };
    p.factors.push(factor);
    return { enroll_status: e.status, factor_fp: fp(factor.id), factor_index: p.factors.length - 1, ...sessionView(slot) };
  },
  async claims({ label, slot, as }) {
    const c = jwtClaims(slotOf(people[label], slot).access);
    await handoff(`sid_${as}`, c.session_id);
    await handoff(`sid_iat_${as}`, String(c.iat));
    return { ok: true, sid_fp: fp(c.session_id) };
  },
  async probe({ label, slot }) {
    const s = slotOf(people[label], slot);
    const uid = jwtClaims(s.access).sub;
    if (!groupTenant) {
      const g = await call("/rest/v1/tenants?select=id&tenant_type=eq.GROUP&status=eq.active&order=created_at&limit=1", { token: s.access });
      groupTenant = Array.isArray(g.json) && g.json[0] ? g.json[0].id : null;
    }
    const rpc = async (fn, body) => {
      const r = await call(`/rest/v1/rpc/${fn}`, { method: "POST", body, token: s.access });
      return r.status === 200 ? r.json : `http_${r.status}`;
    };
    const rows = async (path) => {
      const r = await call(path, { token: s.access });
      return Array.isArray(r.json) ? r.json.length : `http_${r.status}`;
    };
    const t = { p_user_id: uid, p_tenant_id: groupTenant };
    const u = await call("/auth/v1/user", { token: s.access });
    return {
      ...sessionView(s),
      group_tenant_known: Boolean(groupTenant),
      tenants: await rows("/rest/v1/tenants?select=id"),
      audit_rows: await rows("/rest/v1/security_audit_events?select=id&limit=1000"),
      is_super_owner: await rpc("is_super_owner", { p_user_id: uid }),
      is_super_admin: await rpc("is_super_admin", { p_user_id: uid }),
      is_normal_super_owner: await rpc("is_normal_super_owner", { p_user_id: uid }),
      can_access_tenant_data: groupTenant ? await rpc("can_access_tenant_data", t) : null,
      can_administer_tenant: groupTenant ? await rpc("can_administer_tenant", t) : null,
      g7d_group_basis: groupTenant
        ? await rpc("platform_tenant_access_basis_valid_now", { ...t, p_basis: "super_owner_group_access", p_access_level: "operational_admin", p_grant_id: null })
        : null,
      gotrue_user_status: u.status,
    };
  },
  async tenant_probe({ label, slot, t1, t2, group, spoof = [], mutate = false, tag = "probe" }) {
    const s = slotOf(people[label], slot);
    const uid = jwtClaims(s.access).sub;
    const rpc = async (fn, body) => {
      const r = await call(`/rest/v1/rpc/${fn}`, { method: "POST", body, token: s.access });
      return r.status === 200 ? r.json : `http_${r.status}`;
    };
    const rows = async (path) => {
      const r = await call(path, { token: s.access });
      return Array.isArray(r.json) ? r.json.length : `http_${r.status}`;
    };
    const view = async (t) => {
      const self = { p_user_id: uid, p_tenant_id: t };
      return {
        tenant_row: await rows(`/rest/v1/tenants?select=id&id=eq.${t}`),
        settings_rows: await rows(`/rest/v1/tenant_settings?select=tenant_id&tenant_id=eq.${t}`),
        own_membership_rows: await rows(`/rest/v1/tenant_memberships?select=role&tenant_id=eq.${t}&user_id=eq.${uid}`),
        referral_rows: await rows(`/rest/v1/referral_codes?select=id&tenant_id=eq.${t}`),
        has_tenant_membership: await rpc("has_tenant_membership", self),
        can_access_tenant_data: await rpc("can_access_tenant_data", self),
        can_administer_tenant: await rpc("can_administer_tenant", self),
        can_access_tenant: await rpc("can_access_tenant", self),
        auth_is_tenant_staff: await rpc("auth_is_tenant_staff", { p_tenant_id: t }),
        auth_is_tenant_admin: await rpc("auth_is_tenant_admin", { p_tenant_id: t }),
        auth_can_access_tenant: await rpc("auth_can_access_tenant", { p_tenant_id: t }),
        auth_can_administer_tenant: await rpc("auth_can_administer_tenant", { p_tenant_id: t }),
      };
    };
    const mutation = async (t) => {
      const upd = await call(`/rest/v1/tenant_settings?tenant_id=eq.${t}`, {
        method: "PATCH",
        body: { regulatory: { g7f3c3b_probe: tag } },
        token: s.access,
        prefer: "return=representation",
      });
      const ins = await call("/rest/v1/referral_codes", {
        method: "POST",
        body: { code: `GB${randomBytes(5).toString("hex").toUpperCase()}`, tenant_id: t, created_by: uid },
        token: s.access,
        prefer: "return=minimal",
      });
      return {
        settings_update_rows: Array.isArray(upd.json) ? upd.json.length : `http_${upd.status}`,
        referral_insert_status: ins.status,
      };
    };
    const spoofed = [];
    for (const x of spoof) {
      const other = { p_user_id: x, p_tenant_id: t1 };
      spoofed.push({
        subject_fp: fp(x),
        has_tenant_membership: await rpc("has_tenant_membership", other),
        can_access_tenant_data: await rpc("can_access_tenant_data", other),
        can_administer_tenant: await rpc("can_administer_tenant", other),
        can_access_tenant: await rpc("can_access_tenant", other),
        can_access_group_tenant_data: group ? await rpc("can_access_tenant_data", { p_user_id: x, p_tenant_id: group }) : null,
      });
    }
    const u = await call("/auth/v1/user", { token: s.access });
    return {
      ...sessionView(s),
      t1: await view(t1),
      t1_mutation: mutate ? await mutation(t1) : null,
      t2: t2 ? await view(t2) : null,
      t2_mutation: mutate && t2 ? await mutation(t2) : null,
      spoof: spoofed,
      gotrue_user_status: u.status,
    };
  },
  async reverify({ label, slot }) {
    const p = people[label];
    const s = slotOf(p, slot);
    const factor = p.factors[p.factors.length - 1];
    const cv = await challengeVerify(p, s, factor);
    return { factor_fp: fp(factor.id), ...cv, ...sessionView(s) };
  },
  async snapshot({ label, from, to }) {
    const p = people[label];
    p.slots[to] = { ...slotOf(p, from) };
    return { ok: true, ...sessionView(p.slots[to]) };
  },
  async use({ label, slot }) {
    const p = people[label];
    slotOf(p, slot);
    p.current = slot;
    return { ok: true };
  },
  async tenants({ label, slot }) {
    const s = slotOf(people[label], slot);
    const r = await call("/rest/v1/tenants?select=id", { token: s.access, prefer: "count=exact" });
    return { status: r.status, rows: Array.isArray(r.json) ? r.json.length : null, code: r.status === 200 ? null : errCode(r) };
  },
  async is_super_owner({ label, slot }) {
    const s = slotOf(people[label], slot);
    const uid = jwtClaims(s.access).sub;
    const r = await call("/rest/v1/rpc/is_super_owner", { method: "POST", body: { p_user_id: uid }, token: s.access });
    return { status: r.status, value: r.status === 200 ? r.json : null, code: r.status === 200 ? null : errCode(r) };
  },
  async user({ label, slot }) {
    const s = slotOf(people[label], slot);
    const r = await call("/auth/v1/user", { token: s.access });
    const factors = Array.isArray(r.json?.factors) ? r.json.factors : [];
    return {
      status: r.status,
      code: r.status === 200 ? null : errCode(r),
      factors: factors.map((f) => ({ fp: fp(f.id), status: f.status })),
    };
  },
  async refresh({ label, slot }) {
    const s = slotOf(people[label], slot);
    const r = await call("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: s.refresh } });
    if (r.status === 200) {
      s.access = r.json.access_token;
      s.refresh = r.json.refresh_token;
    }
    return { status: r.status, code: r.status === 200 ? null : errCode(r), ...(r.status === 200 ? sessionView(s) : {}) };
  },
  async challenge_factor({ label, slot, index }) {
    const p = people[label];
    const s = slotOf(p, slot);
    const factor = p.factors[index];
    const ch = await call(`/auth/v1/factors/${factor.id}/challenge`, { method: "POST", body: {}, token: s.access });
    let verify = null;
    if (ch.status === 200) {
      const v = await call(`/auth/v1/factors/${factor.id}/verify`, {
        method: "POST",
        body: { challenge_id: ch.json.id, code: await freshCode(factor) },
        token: s.access,
      });
      verify = { status: v.status, code: v.status === 200 ? null : errCode(v) };
    }
    return { factor_fp: fp(factor.id), challenge_status: ch.status, challenge_code: ch.status === 200 ? null : errCode(ch), verify };
  },
  async grant({ tag }) {
    const g = rec.formatRecoveryGrant(new Uint8Array(randomBytes(rec.MFA_RECOVERY_GRANT_BYTES)));
    grants[tag] = g;
    const digest = createHash("sha256").update(rec.MFA_RECOVERY_GRANT_HASH_PREFIX + rec.normaliseRecoveryGrant(g), "utf8").digest("hex");
    await handoff(`gh_${tag}`, digest);
    return { ok: true, grant_chars: g.replace(/-/g, "").length };
  },
  async type_grant({ tag, as }) {
    const typed = ` ${grants[tag].toLowerCase().replace(/-/g, " ").replace(/0/g, "o").replace(/1/g, "l")} `;
    const canonical = rec.normaliseRecoveryGrant(typed);
    const digest = createHash("sha256").update(rec.MFA_RECOVERY_GRANT_HASH_PREFIX + canonical, "utf8").digest("hex");
    await handoff(`rh_${as}`, digest);
    return { ok: Boolean(canonical) };
  },
  async wrong_grant({ as }) {
    const g = rec.formatRecoveryGrant(new Uint8Array(randomBytes(rec.MFA_RECOVERY_GRANT_BYTES)));
    const digest = createHash("sha256").update(rec.MFA_RECOVERY_GRANT_HASH_PREFIX + rec.normaliseRecoveryGrant(g), "utf8").digest("hex");
    await handoff(`rh_${as}`, digest);
    return { ok: true };
  },
  async forget() {
    for (const p of Object.values(people)) {
      p.password = null;
      p.slots = {};
      p.factors = [];
    }
    for (const k of Object.keys(grants)) delete grants[k];
    return { ok: true };
  },
};

async function runCommand(cmd) {
  const list = Array.isArray(cmd.ops) ? cmd.ops : [cmd];
  const results = [];
  for (const c of list) {
    const started = Date.now();
    try {
      if (!ops[c.op]) throw new Error(`unknown op ${c.op}`);
      results.push({ op: c.op, label: c.label ?? null, slot: c.slot ?? null, ...(await ops[c.op](c)), ms: Date.now() - started });
    } catch (e) {
      results.push({ op: c.op, label: c.label ?? null, error: String(e?.message ?? e).slice(0, 200) });
    }
  }
  return results;
}

const done = new Set();
let running = true;
console.log(`G7F3C3_LIVE_DRIVER ready project=${fp(BASE)} personas=${PERSONAS.length}`);
while (running) {
  const files = readdirSync(`${DIR}/cmd`).filter((f) => f.endsWith(".json") && !done.has(f)).sort();
  for (const f of files) {
    done.add(f);
    let cmd;
    try {
      cmd = JSON.parse(readFileSync(`${DIR}/cmd/${f}`, "utf8"));
    } catch {
      continue;
    }
    if (cmd.op === "exit") {
      await ops.forget();
      running = false;
      writeFileSync(`${DIR}/out/${f}`, JSON.stringify([{ op: "exit", ok: true }]));
      break;
    }
    const results = await runCommand(cmd);
    const tmp = `${DIR}/out/.${f}`;
    writeFileSync(tmp, JSON.stringify(results));
    renameSync(tmp, `${DIR}/out/${f}`);
    console.log(`G7F3C3_LIVE ${f} ${results.map((r) => `${r.op}${r.error ? ":ERR" : ""}`).join(",")}`);
  }
  if (running) await sleep(200);
}
if (existsSync(`${DIR}/cmd`)) console.log("G7F3C3_LIVE_DRIVER exit (secrets cleared)");
