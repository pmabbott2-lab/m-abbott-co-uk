/**
 * G7F-4S1B appointment account-takeover remediation — unit + static verification.
 * Fetch stub bound to a non-routable host: synthetic fixtures only, no real Auth user, no database,
 * no network, no production. SMS codes exist only in this process and are never printed.
 * Run: npm exec --yes --package=tsx -- tsx scripts/g7f4s1b-appointment-takeover-verify.mjs
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

for (const k of [
  "SUPABASE_URL",
  "VITE_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_MESSAGING_SERVICE_SID",
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
async function rejects(fn) {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}
const code = (rel) =>
  readFileSync(resolve(root, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const FAKE_HOST = "g7f4s1b.invalid";
process.env.SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_g7f4s1b_not_a_real_key";

const IDS = {
  customer: "a1111111-1111-4111-8111-111111111111",
  owner: "a2222222-2222-4222-8222-222222222222",
  phoneOnly: "a3333333-3333-4333-8333-333333333333",
  spoofer: "a4444444-4444-4444-8444-444444444444",
  victim: "a5555555-5555-4555-8555-555555555555",
  tenantOwner: "a6666666-6666-4666-8666-666666666666",
  breakGlass: "a7777777-7777-4777-8777-777777777777",
  underscore: "a8888888-8888-4888-8888-888888888888",
};
let createdSeq = 0;
const newId = () => `b${String(++createdSeq).padStart(7, "0")}-0000-4000-8000-000000000000`;

let db;
function resetDb() {
  db = {
    authUsers: new Map([
      [IDS.customer, { id: IDS.customer, email: "existing.customer@example.test" }],
      [IDS.owner, { id: IDS.owner, email: "synthetic.owner@example.test" }],
      [
        IDS.phoneOnly,
        { id: IDS.phoneOnly, email: "phone+447700900003@customers.mortgagehub.local" },
      ],
      [IDS.spoofer, { id: IDS.spoofer, email: "spoofer@example.test" }],
      [IDS.victim, { id: IDS.victim, email: "victim@example.test" }],
      [IDS.tenantOwner, { id: IDS.tenantOwner, email: "tenant.owner@example.test" }],
      [IDS.breakGlass, { id: IDS.breakGlass, email: "break.glass@example.test" }],
      [IDS.underscore, { id: IDS.underscore, email: "a_b@example.test" }],
    ]),
    profiles: new Map([
      [
        IDS.customer,
        {
          id: IDS.customer,
          full_name: "Existing Customer",
          email: "existing.customer@example.test",
          phone: "+447700900001",
        },
      ],
      [
        IDS.owner,
        {
          id: IDS.owner,
          full_name: "Synthetic Owner",
          email: "synthetic.owner@example.test",
          phone: "+447700900002",
        },
      ],
      [
        IDS.phoneOnly,
        { id: IDS.phoneOnly, full_name: "Phone Only", email: null, phone: "+447700900003" },
      ],
      // Self-edited profile: email claims the victim's address, Auth email is the spoofer's own.
      [
        IDS.spoofer,
        {
          id: IDS.spoofer,
          full_name: "Spoofer",
          email: "victim@example.test",
          phone: "+447700900004",
        },
      ],
      [
        IDS.tenantOwner,
        {
          id: IDS.tenantOwner,
          full_name: "Tenant Owner",
          email: "tenant.owner@example.test",
          phone: "+447700900006",
        },
      ],
      [
        IDS.breakGlass,
        {
          id: IDS.breakGlass,
          full_name: "Break Glass",
          email: "break.glass@example.test",
          phone: "+447700900007",
        },
      ],
      [
        IDS.underscore,
        {
          id: IDS.underscore,
          full_name: "Underscore",
          email: "a_b@example.test",
          phone: "+447700900008",
        },
      ],
    ]),
    platformRoles: [{ user_id: IDS.owner, role: "super_owner" }],
    breakGlass: [{ user_id: IDS.breakGlass, active: true }],
    memberships: [{ user_id: IDS.tenantOwner, role: "owner" }],
    userRoles: [],
    failTable: null,
  };
}

const calls = [];
const json = (v, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
const eqParam = (url, key) => {
  const v = url.searchParams.get(key);
  return v && v.startsWith("eq.") ? v.slice(3) : null;
};

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : (input.url ?? String(input)));
  if (url.hostname !== FAKE_HOST)
    throw new Error(`G7F4S1B fetch stub refused host ${url.hostname}`);
  const method = String(
    init.method || (typeof input === "object" && input.method) || "GET",
  ).toUpperCase();
  let body = null;
  try {
    body = init.body ? JSON.parse(String(init.body)) : null;
  } catch {
    body = null;
  }
  const p = url.pathname;
  calls.push({ method, path: p, search: url.search, body });

  if (p === "/rest/v1/profiles" && method === "GET") {
    const emailFilter = url.searchParams.get("email");
    const phone = eqParam(url, "phone");
    let rows = [...db.profiles.values()];
    if (emailFilter?.startsWith("ilike.")) {
      const literal = emailFilter
        .slice(6)
        .replace(/\\([\\%_])/g, "$1")
        .toLowerCase();
      rows = rows.filter((r) => (r.email ?? "").toLowerCase() === literal);
    }
    if (phone) rows = rows.filter((r) => r.phone === phone);
    return json(rows.map((r) => ({ id: r.id })));
  }
  if (p === "/rest/v1/profiles" && (method === "POST" || method === "PATCH")) {
    return new Response(null, { status: 201 });
  }
  if (p === "/rest/v1/user_roles" && method === "POST") return new Response(null, { status: 201 });

  const lookup = (table, rows) => {
    if (db.failTable === table) return json({ message: "boom", code: "XX000" }, 500);
    const uid = eqParam(url, "user_id");
    const neqRole = url.searchParams.get("role");
    let out = rows.filter((r) => r.user_id === uid);
    if (neqRole?.startsWith("neq.")) out = out.filter((r) => r.role !== neqRole.slice(4));
    return json(out.map((r) => ({ user_id: r.user_id })));
  };
  if (p === "/rest/v1/platform_roles") return lookup("platform_roles", db.platformRoles);
  if (p === "/rest/v1/platform_break_glass_identities")
    return lookup("platform_break_glass_identities", db.breakGlass);
  if (p === "/rest/v1/tenant_memberships") return lookup("tenant_memberships", db.memberships);
  if (p === "/rest/v1/user_roles" && method === "GET") return lookup("user_roles", db.userRoles);

  if (p === "/auth/v1/admin/users" && method === "POST") {
    const email = String(body?.email ?? "").toLowerCase();
    if ([...db.authUsers.values()].some((u) => u.email === email)) {
      return json(
        { code: "email_exists", msg: "A user with this email address has already been registered" },
        422,
      );
    }
    const id = newId();
    db.authUsers.set(id, { id, email });
    return json({ id, email, aud: "authenticated", role: "authenticated" });
  }
  const userMatch = p.match(/^\/auth\/v1\/admin\/users\/([0-9a-f-]+)$/);
  if (userMatch && method === "GET") {
    const u = db.authUsers.get(userMatch[1]);
    return u
      ? json({ ...u, aud: "authenticated", role: "authenticated" })
      : json({ msg: "User not found" }, 404);
  }
  if (userMatch && method === "PUT") return json({ id: userMatch[1] });
  if (p === "/auth/v1/admin/generate_link" && method === "POST") {
    const email = String(body?.email ?? "").toLowerCase();
    const u = [...db.authUsers.values()].find((x) => x.email === email);
    if (!u) return json({ msg: "User not found" }, 404);
    return json({
      ...u,
      aud: "authenticated",
      role: "authenticated",
      action_link: `http://${FAKE_HOST}/verify`,
      email_otp: "000000",
      hashed_token: `synthetic-hash-${u.id}`,
      redirect_to: "",
      verification_type: "magiclink",
    });
  }
  return json({ message: `unexpected ${method} ${p}` }, 500);
};

const mod = await import("../src/lib/appointment-signup.server.ts");
// G7F-4S3B: appointment-created Auth identities use the phone-derived synthetic email.
const syntheticEmail = (e164) => `phone+${e164.replace(/\D/g, "")}@customers.mortgagehub.local`;
const store = await import("../src/lib/auth-sms.store.server.ts");

let books;
let sms;
function freshDeps(twilio = true) {
  books = [];
  sms = [];
  return {
    book: async (booking, actingUserId) => {
      books.push({ booking, actingUserId });
      return { id: "appt" };
    },
    sendSms: async (opts) => {
      sms.push(opts);
      return { sid: "SMsynthetic" };
    },
    isTwilioConfigured: () => twilio,
  };
}
function reset() {
  resetDb();
  calls.length = 0;
}
const profileWrites = () =>
  calls.filter((c) => c.path === "/rest/v1/profiles" && c.method !== "GET");
const passwordWrites = () =>
  calls.filter((c) => /^\/auth\/v1\/admin\/users\/[0-9a-f-]+$/.test(c.path) && c.method === "PUT");
const createUsers = () =>
  calls.filter((c) => c.path === "/auth/v1/admin/users" && c.method === "POST");
const linkCalls = () => calls.filter((c) => c.path === "/auth/v1/admin/generate_link");
const codeFrom = (body) => body.match(/Sign-in code: (\d{6})/)?.[1] ?? null;
const SLOT = "2026-10-05T09:00:00.000Z";
const signup = (over, deps) =>
  mod.customerAppointmentSignupImpl(
    {
      customerName: "Caller Supplied",
      customerPhone: "07700 900999",
      customerEmail: "",
      startsAt: SLOT,
      ...over,
    },
    deps,
  );

// --- 1-3, 5: existing email match -------------------------------------------------------------
reset();
let deps = freshDeps();
let res = await signup(
  {
    customerEmail: "Existing.Customer@example.test",
    customerPhone: "07700 900999",
    password: "caller-chosen-pw",
  },
  deps,
);
ok("1 existing email: no Auth Admin password update", passwordWrites().length === 0);
ok("2 existing email: trusted phone not written", profileWrites().length === 0);
ok(
  "3 existing email: trusted email not written",
  profileWrites().length === 0 &&
    db.profiles.get(IDS.customer).email === "existing.customer@example.test",
);
ok("5 existing email: password input ignored, no createUser", createUsers().length === 0);
ok("existing email: booking still made", books.length === 1);
ok(
  "existing email: booking not linked to the existing account",
  books[0].booking.customerId === undefined && books[0].actingUserId === undefined,
);
ok("existing email: no SMS login code issued", sms.length === 0 && res.needsSmsCode === false);
ok(
  "existing email: no sign-in identifier returned",
  !("signInEmail" in res) && res.signInRequired === true,
);

// --- 4, 6: existing phone match -----------------------------------------------------------------
reset();
deps = freshDeps();
res = await signup(
  { customerEmail: "brand.new@example.test", customerPhone: "07700 900001" },
  deps,
);
ok(
  "4 existing phone: no profile/identity write",
  profileWrites().length === 0 && passwordWrites().length === 0,
);
ok("4 existing phone: no new account created", createUsers().length === 0);
ok("6 existing phone: no SMS code to caller phone", sms.length === 0 && res.needsSmsCode === false);
ok(
  "existing phone: booking unlinked",
  books.length === 1 && books[0].booking.customerId === undefined,
);

reset();
deps = freshDeps();
res = await signup({ customerEmail: "", customerPhone: "07700 900003" }, deps);
ok(
  "phone-only existing account: no code, no identifier, no write",
  sms.length === 0 &&
    profileWrites().length === 0 &&
    passwordWrites().length === 0 &&
    res.signInRequired,
);

reset();
deps = freshDeps();
res = await signup(
  { customerEmail: "existing.customer@example.test", customerPhone: "07700 900002" },
  deps,
);
ok(
  "email=A phone=B collision: no writes to either account",
  profileWrites().length === 0 && passwordWrites().length === 0 && sms.length === 0,
);

// --- privileged accounts --------------------------------------------------------------------
reset();
deps = freshDeps();
res = await signup(
  { customerEmail: "synthetic.owner@example.test", password: "caller-chosen-pw" },
  deps,
);
ok(
  "privileged email: no password/profile write, no code, no identifier",
  passwordWrites().length === 0 &&
    profileWrites().length === 0 &&
    sms.length === 0 &&
    res.signInRequired &&
    !("signInEmail" in res),
);

// --- 6: redirected SMS / login-code reuse -----------------------------------------------------
reset();
store.storeLoginSmsCode(IDS.spoofer, "123456");
ok(
  "6 login SMS code cannot be redeemed as appointment sign-in",
  await rejects(() =>
    mod.verifyAppointmentSignupSmsImpl({ phone: "07700 900004", code: "123456" }),
  ),
);
ok("6 no magic link minted for unbound phone", linkCalls().length === 0);

// --- 7: profile.email cannot redirect magic-link identity -------------------------------------
reset();
deps = freshDeps();
res = await signup({ customerEmail: "victim@example.test", customerPhone: "07700 900555" }, deps);
ok(
  "7 spoofed profile email: Auth mismatch treated as ambiguous (unlinked, no code)",
  books[0].booking.customerId === undefined && sms.length === 0 && createUsers().length === 0,
);

reset();
deps = freshDeps();
res = await signup(
  { customerEmail: "fresh.customer@example.test", customerPhone: "07700 900777" },
  deps,
);
const freshId =
  createUsers().length === 1
    ? [...db.authUsers.values()].find((u) => u.email === syntheticEmail("+447700900777"))?.id
    : null;
const freshCode = sms[0] ? codeFrom(sms[0].body) : null;
db.profiles.set(freshId, {
  id: freshId,
  full_name: "x",
  email: "victim@example.test",
  phone: "+447700900777",
});
calls.length = 0;
const tok = await mod
  .verifyAppointmentSignupSmsImpl({ phone: "07700 900777", code: freshCode ?? "" })
  .catch(() => null);
const linkEmail = linkCalls()[0]?.body?.email;
ok(
  "7 magic link uses Auth email of the bound account, not profiles.email",
  linkEmail === syntheticEmail("+447700900777") && tok?.tokenHash === `synthetic-hash-${freshId}`,
);

// --- defence in depth: a challenge bound to a privileged/staff account never yields a link ----
for (const [label, id, phone] of [
  ["super owner", IDS.owner, "+447700900002"],
  ["break-glass", IDS.breakGlass, "+447700900007"],
  ["tenant owner", IDS.tenantOwner, "+447700900006"],
]) {
  reset();
  store.storeAppointmentSignupChallenge(phone, id, "654321");
  const refused = await rejects(() =>
    mod.verifyAppointmentSignupSmsImpl({ phone, code: "654321" }),
  );
  ok(`privileged binding refused (${label})`, refused && linkCalls().length === 0);
}
reset();
db.failTable = "platform_roles";
store.storeAppointmentSignupChallenge("+447700900001", IDS.customer, "111222");
ok(
  "eligibility lookup error fails closed",
  (await rejects(() =>
    mod.verifyAppointmentSignupSmsImpl({ phone: "07700 900001", code: "111222" }),
  )) && linkCalls().length === 0,
);

reset();
store.storeAppointmentSignupChallenge("+447700900888", IDS.customer, "222333");
for (let i = 0; i < 5; i += 1) {
  await mod
    .verifyAppointmentSignupSmsImpl({ phone: "07700 900888", code: "999999" })
    .catch(() => null);
}
ok(
  "challenge invalidated after 5 failed attempts",
  (await rejects(() =>
    mod.verifyAppointmentSignupSmsImpl({ phone: "07700 900888", code: "222333" }),
  )) && linkCalls().length === 0,
);

reset();
const underscoreRes = await mod.resolveOrCreateCustomerProfile({
  customerName: "n",
  customerPhone: "07700 900111",
  customerEmail: "a_b@example.test",
});
const emailSearch = calls.find(
  (c) => c.path === "/rest/v1/profiles" && c.search.includes("email="),
);
ok(
  "email lookup escapes LIKE wildcards",
  new URLSearchParams(emailSearch?.search ?? "").get("email") === "ilike.a\\_b@example.test" &&
    underscoreRes.kind === "existing",
);

// --- 8, 9: staff / introducer collision -------------------------------------------------------
reset();
const staffId = await mod.resolveCustomerIdForStaffBooking({
  customerName: "Staff Typed",
  customerPhone: "07700 900999",
  customerEmail: "existing.customer@example.test",
});
ok(
  "8 staff collision: links existing id read-only",
  staffId === IDS.customer &&
    profileWrites().length === 0 &&
    passwordWrites().length === 0 &&
    createUsers().length === 0,
);
reset();
const introId = await mod.resolveCustomerIdForStaffBooking({
  customerName: "Intro Typed",
  customerPhone: "07700 900001",
  customerEmail: "other@example.test",
});
ok(
  "9 introducer collision (phone): links existing id read-only",
  introId === IDS.customer && profileWrites().length === 0 && passwordWrites().length === 0,
);
reset();
ok(
  "staff booking with spoofed profile email is refused, not linked",
  await rejects(() =>
    mod.resolveCustomerIdForStaffBooking({
      customerName: "n",
      customerPhone: "07700 900123",
      customerEmail: "victim@example.test",
    }),
  ),
);
reset();
const staffNew = await mod.resolveCustomerIdForStaffBooking({
  customerName: "New Person",
  customerPhone: "07700 900321",
  customerEmail: "new.person@example.test",
});
ok(
  "staff booking new customer still creates account",
  createUsers().length === 1 &&
    db.authUsers.get(staffNew)?.email === syntheticEmail("+447700900321"),
);

// --- 10: legitimate new-customer booking ------------------------------------------------------
reset();
deps = freshDeps(true);
res = await signup(
  {
    customerName: "New Customer",
    customerEmail: "new.customer@example.test",
    customerPhone: "07700 900444",
  },
  deps,
);
const created = createUsers();
const newUserId = [...db.authUsers.values()].find(
  (u) => u.email === syntheticEmail("+447700900444"),
)?.id;
ok(
  "10 new customer: account created once without password",
  created.length === 1 && !("password" in (created[0].body ?? {})),
);
ok(
  "10 new customer: profile created for new id only",
  profileWrites().length === 1 && profileWrites()[0].body?.id === newUserId,
);
ok(
  "10 new customer: booking linked to new account",
  books.length === 1 && books[0].booking.customerId === newUserId,
);
ok(
  "10 new customer: SMS code sent to supplied phone",
  sms.length === 1 && sms[0].to === "+447700900444" && res.needsSmsCode === true,
);
calls.length = 0;
const newTok = await mod
  .verifyAppointmentSignupSmsImpl({ phone: "07700 900444", code: codeFrom(sms[0].body) ?? "" })
  .catch(() => null);
ok(
  "10 new customer: SMS verification signs in the new account",
  newTok?.tokenHash === `synthetic-hash-${newUserId}` &&
    linkCalls()[0]?.body?.email === syntheticEmail("+447700900444"),
);
ok(
  "10 code is single-use",
  await rejects(() =>
    mod.verifyAppointmentSignupSmsImpl({
      phone: "07700 900444",
      code: codeFrom(sms[0].body) ?? "",
    }),
  ),
);

reset();
deps = freshDeps(false);
res = await signup(
  { customerName: "No Twilio", customerEmail: "", customerPhone: "07700 900445" },
  deps,
);
ok(
  "10 new customer without SMS configured: booking kept, sign-in required",
  books.length === 1 &&
    res.needsSmsCode === false &&
    res.signInRequired === true &&
    sms.length === 0,
);

// --- static guards ----------------------------------------------------------------------------
const booking = code("src/lib/booking.functions.ts");
const authFns = code("src/lib/auth.functions.ts");
const signupMod = code("src/lib/appointment-signup.server.ts");
const component = code("src/components/CustomerAppointmentSignup.tsx");
const signupSchema =
  booking.match(/const customerAppointmentSignupInput = z\.object\(\{[\s\S]*?\}\);/)?.[0] ?? "";
ok(
  "static: signup schema has no password field",
  signupSchema.length > 0 && !/password/.test(signupSchema),
);
ok(
  "static: no updateUserById in booking or signup module",
  !/updateUserById/.test(booking) && !/updateUserById/.test(signupMod),
);
ok(
  "static: booking.functions has no profile identity update helper",
  !/resolveOrCreateCustomerProfile\(/.test(booking),
);
ok(
  "static: staff + introducer booking use read-only resolver",
  (booking.match(/resolveCustomerIdForStaffBooking\(\{/g) ?? []).length === 2,
);
ok(
  "static: signup module never updates profiles",
  !/from\("profiles"\)[\s\S]{0,80}\.update\(/.test(signupMod),
);
ok(
  "static: verifyAppointmentSignupSms delegates to bound-challenge impl",
  /verifyAppointmentSignupSmsImpl\(data\)/.test(authFns) &&
    !/verifyLoginSmsCode\(profile/.test(authFns),
);
ok(
  "static: magic link email not derived from profiles",
  !/emailForCustomerAccount\(profile/.test(authFns + signupMod),
);
ok(
  "static: signup component has no password field or password sign-in",
  !/type="password"/.test(component) && !/signInWithPassword/.test(component),
);

console.log(`\n${total - failures.length}/${total} passed`);
if (failures.length) {
  console.error(`FAILED: ${failures.join(", ")}`);
  process.exit(1);
}
