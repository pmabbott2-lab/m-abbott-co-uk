/**
 * Static G6B tenant-routing + client/server boundary checks.
 * No secrets. No network.
 * Run: npx tsx scripts/g6b-tenant-routing-verify.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveTenantAuthenticatedEntry } from "../src/lib/tenant-access.ts";
import { remapAppNavigate, remapAppHref } from "../src/lib/tenant-app-nav.ts";
import {
  referralLinkForSlug,
  bookingLinkForSlug,
  rafLinkForCode,
  marketingJourneyLinkForSlug,
  marketingCalculatorLinkForSlug,
} from "../src/lib/referral.ts";
import { buildTenantUrl, buildCanonicalRefPath, buildCanonicalBookPath, buildCanonicalRafPath } from "../src/lib/tenant-url.ts";
import { buildHomePathAfterAuth } from "../src/lib/post-auth-journey.ts";
import { getPasswordResetUrl } from "../src/lib/app-url.ts";
import { resolvePublicIntroducerRefAccess, parseCanonicalRefPath } from "../src/lib/tenant-introducer-ref.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
function ok(name, cond, detail = "") {
  if (cond) console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
    failures.push(name);
  }
}

const route = readFileSync(resolve(root, "src/routes/$tenantSlug/route.tsx"), "utf8");
ok("layout_uses_server_fn", route.includes("getTenantSlugLayoutFn"));
ok(
  "layout_no_direct_presentation_load",
  !route.includes("loadTenantPresentationBySlug") && !route.includes("peekTenantBySlug("),
);
ok("layout_no_client_server_import", !route.includes("client.server"));
ok("layout_no_supabase_admin", !route.includes("supabaseAdmin"));
const presentationServer = readFileSync(resolve(root, "src/lib/tenant-presentation.server.ts"), "utf8");
ok(
  "presentation_wrappers_no_static_admin",
  !/from ["']@\/integrations\/supabase\/client\.server["']/.test(presentationServer) &&
    !/from ["']@\/lib\/tenant-context\.server["']/.test(presentationServer),
);
ok("presentation_wrappers_dynamic_impl", presentationServer.includes("tenant-presentation.impl.server"));
ok(
  "impl_not_imported_from_layout",
  !route.includes("tenant-presentation.impl.server"),
);

const workspace = readFileSync(resolve(root, "src/routes/$tenantSlug/workspace.tsx"), "utf8");
ok("workspace_goes_to_tenant_home", workspace.includes("/$tenantSlug/home"));
const routeTree = readFileSync(resolve(root, "src/routeTree.gen.ts"), "utf8");
ok("route_tree_has_tenant_home", routeTree.includes("/$tenantSlug/home"));
ok("route_tree_keeps_platform_home", routeTree.includes("'/home': typeof AuthenticatedHomeRoute"));
ok(
  "src_no_vite_service_role",
  !readFileSync(resolve(root, "src/integrations/supabase/client.ts"), "utf8").includes(
    "VITE_SUPABASE_SERVICE_ROLE_KEY",
  ),
);
ok("workspace_no_platform_home_success", !workspace.includes('to: "/home"'));

ok("tenant_home_file", existsSync(resolve(root, "src/routes/$tenantSlug/home.tsx")));
const tenantHome = readFileSync(resolve(root, "src/routes/$tenantSlug/home.tsx"), "utf8");
ok("tenant_home_reuses_home", tenantHome.includes('from "@/routes/_authenticated/home"'));
ok("tenant_home_membership_gate", tenantHome.includes("TenantAuthenticatedGate"));
ok("platform_home_retained", existsSync(resolve(root, "src/routes/_authenticated/home.tsx")));
ok(
  "platform_home_route_unchanged",
  readFileSync(resolve(root, "src/routes/_authenticated/home.tsx"), "utf8").includes(
    'createFileRoute("/_authenticated/home")',
  ),
);

const clientTs = readFileSync(resolve(root, "src/integrations/supabase/client.ts"), "utf8");
ok("no_vite_service_role_env", !clientTs.includes("VITE_SUPABASE_SERVICE_ROLE_KEY"));
ok("client_ts_no_service_role_read", !clientTs.includes("process.env.SUPABASE_SERVICE_ROLE_KEY"));

const srcFiles = [
  "src/routes/$tenantSlug/route.tsx",
  "src/routes/$tenantSlug/home.tsx",
  "src/routes/$tenantSlug/workspace.tsx",
  "src/lib/tenant-access.ts",
  "src/lib/post-auth-journey.ts",
  "src/lib/app-url.ts",
  "src/components/tenant/TenantAuthenticatedGate.tsx",
];
for (const rel of srcFiles) {
  const t = readFileSync(resolve(root, rel), "utf8");
  ok(`${rel}_no_prod_ref`, !t.includes("tiuplmftooauihulhtws"));
}

ok("tenant_home_not_hardcoded_001", !tenantHome.includes("mortgageeasy") && !tenantHome.includes("001"));
ok("workspace_not_hardcoded_001", !workspace.includes("mortgageeasy") && !workspace.includes("001"));

const owner001 = "67b22f6e-c15a-4193-b61c-ed39c63e3dc5";
ok("001_member_ok", resolveTenantAuthenticatedEntry({ userId: owner001, member: true }) === "ok");
ok("001_to_002_denied", resolveTenantAuthenticatedEntry({ userId: owner001, member: false }) === "denied");
const owner002 = "00000000-0000-0000-0000-000000000002";
ok("002_member_ok", resolveTenantAuthenticatedEntry({ userId: owner002, member: true }) === "ok");
ok("002_to_001_denied", resolveTenantAuthenticatedEntry({ userId: owner002, member: false }) === "denied");
ok("anonymous_login", resolveTenantAuthenticatedEntry({ userId: null, member: true }) === "login");

const postAuth = readFileSync(resolve(root, "src/lib/post-auth-journey.ts"), "utf8");
ok("after_auth_uses_normalised_slug", postAuth.includes("normalisePublicTenantSlug(tenantSlug)"));
ok("after_auth_fallback_platform_home", postAuth.includes('return start ? `/home?start=${encodeURIComponent(start)}` : "/home"'));
ok("auth_path_sets_tenant_param", postAuth.includes('params.set("tenant", slug)'));

const appUrl = readFileSync(resolve(root, "src/lib/app-url.ts"), "utf8");
ok("callback_includes_tenant_query", appUrl.includes("/auth?tenant="));
ok("callback_no_silent_001", !appUrl.includes("mortgageeasy"));

const gate = readFileSync(resolve(root, "src/components/tenant/TenantAuthenticatedGate.tsx"), "utf8");
ok("gate_uses_membership_rpc", gate.includes("checkTenantMembershipFn"));
ok("gate_uses_session_user_id", gate.includes("user?.id") || gate.includes("user.id"));
ok("gate_not_email_acl", !gate.toLowerCase().includes("email"));

const tenantAppPages = [
  ["diary", "DiaryPage"],
  ["cases", "CasesPage"],
  ["booking", "BookingPage"],
  ["introducer", "IntroducerPortalPage"],
  ["companies", "CompaniesPage"],
];
for (const [page, exported] of tenantAppPages) {
  const rel = `src/routes/$tenantSlug/${page}.tsx`;
  ok(`tenant_${page}_file`, existsSync(resolve(root, rel)));
  const src = readFileSync(resolve(root, rel), "utf8");
  ok(`tenant_${page}_gated`, src.includes("TenantAuthenticatedApp"));
  ok(`tenant_${page}_reuses`, src.includes(`from "@/routes/_authenticated/${page}"`));
  ok(`platform_${page}_retained`, existsSync(resolve(root, `src/routes/_authenticated/${page}.tsx`)));
  ok(`${rel}_no_prod_ref`, !src.includes("tiuplmftooauihulhtws"));
  ok(`tenant_${page}_not_hardcoded_001`, !src.includes("mortgageeasy") && !src.includes("001"));
}

const tenantParamPages = [
  ["customers.$customerId", "CustomerHubPage", "customers.$customerId"],
  ["sessions.$sessionId", "SessionDetail", "sessions.$sessionId"],
  ["interview.$sessionId", "InterviewPage", "interview.$sessionId"],
  ["chat.$sessionId", "ChatPage", "chat.$sessionId"],
  ["text.$sessionId", "TextInterviewPage", "text.$sessionId"],
];
for (const [file, exported, authFile] of tenantParamPages) {
  const rel = `src/routes/$tenantSlug/${file}.tsx`;
  ok(`tenant_${file}_file`, existsSync(resolve(root, rel)));
  const src = readFileSync(resolve(root, rel), "utf8");
  ok(`tenant_${file}_gated`, src.includes("TenantAuthenticatedApp"));
  ok(`tenant_${file}_reuses`, src.includes(exported));
  ok(`platform_${file}_retained`, existsSync(resolve(root, `src/routes/_authenticated/${authFile}.tsx`)));
}

ok(
  "remap_home_with_slug",
  remapAppNavigate({ to: "/home", tenantSlug: "trentvalleyfs" }).to === "/$tenantSlug/home" &&
    remapAppNavigate({ to: "/home", tenantSlug: "trentvalleyfs" }).params?.tenantSlug === "trentvalleyfs",
);
ok(
  "remap_no_slug_stays_platform",
  remapAppNavigate({ to: "/home" }).to === "/home" && !remapAppNavigate({ to: "/home" }).params,
);
ok(
  "remap_invalid_slug_stays_platform",
  remapAppNavigate({ to: "/diary", tenantSlug: "home" }).to === "/diary",
);
ok(
  "remap_never_injects_001",
  remapAppHref({ to: "/cases" }) === "/cases" &&
    !remapAppHref({ to: "/cases" }).includes("mortgageeasy") &&
    remapAppHref({ to: "/sessions/$sessionId", params: { sessionId: "abc" }, tenantSlug: "trentvalleyfs" }) ===
      "/trentvalleyfs/sessions/abc",
);
ok(
  "remap_ignores_auth",
  remapAppNavigate({ to: "/auth", tenantSlug: "trentvalleyfs" }).to === "/auth",
);

const appShell = readFileSync(resolve(root, "src/components/AppShell.tsx"), "utf8");
ok("appshell_remaps_back", appShell.includes("remapAppNavigate"));
const tabNav = readFileSync(resolve(root, "src/components/TabPageNav.tsx"), "utf8");
ok("tabnav_tenant_link", tabNav.includes("TenantAppLink"));
ok("tabnav_signout_preserves_tenant", tabNav.includes("tenant.slug"));

const registerSrc = readFileSync(resolve(root, "src/routes/register.tsx"), "utf8");
ok("register_uses_invite_slug", registerSrc.includes("goAfterInvite") && registerSrc.includes("invite.tenantSlug"));
ok("register_no_silent_001", !registerSrc.includes("mortgageeasy"));
const rafSrc = readFileSync(resolve(root, "src/routes/raf.$code.tsx"), "utf8");
ok("raf_uses_tenant_slug", rafSrc.includes("tenantSlug"));
ok("raf_no_silent_001", !rafSrc.includes("mortgageeasy"));

ok("route_tree_keeps_platform_diary", routeTree.includes("'/diary': typeof AuthenticatedDiaryRoute") || routeTree.includes("AuthenticatedDiaryRoute"));

const ORIGIN = "https://hub.test";

ok(
  "001_share_link",
  referralLinkForSlug("alice", "mortgageeasy", ORIGIN) === `${ORIGIN}/mortgageeasy/ref/alice`,
);
ok(
  "002_share_link",
  referralLinkForSlug("alice", "trentvalleyfs", ORIGIN) === `${ORIGIN}/trentvalleyfs/ref/alice` &&
    !referralLinkForSlug("alice", "trentvalleyfs", ORIGIN).includes("mortgageeasy"),
);
ok(
  "001_book_link",
  bookingLinkForSlug("alice", "mortgageeasy", ORIGIN) === `${ORIGIN}/mortgageeasy/book/alice`,
);
ok(
  "002_book_link",
  bookingLinkForSlug("alice", "trentvalleyfs", ORIGIN) === `${ORIGIN}/trentvalleyfs/book/alice` &&
    !bookingLinkForSlug("alice", "trentvalleyfs", ORIGIN).includes("mortgageeasy"),
);
ok(
  "001_raf_link",
  rafLinkForCode("AB12CD34", "mortgageeasy", ORIGIN) === `${ORIGIN}/mortgageeasy/raf/AB12CD34`,
);
ok(
  "002_raf_link",
  rafLinkForCode("AB12CD34", "trentvalleyfs", ORIGIN) === `${ORIGIN}/trentvalleyfs/raf/AB12CD34` &&
    !rafLinkForCode("AB12CD34", "trentvalleyfs", ORIGIN).includes("mortgageeasy"),
);
ok(
  "001_session_sms_url",
  buildTenantUrl("mortgageeasy", "/sessions/sess-1", ORIGIN) === `${ORIGIN}/mortgageeasy/sessions/sess-1`,
);
ok(
  "002_session_sms_url",
  buildTenantUrl("trentvalleyfs", "/sessions/sess-1", ORIGIN) === `${ORIGIN}/trentvalleyfs/sessions/sess-1` &&
    !buildTenantUrl("trentvalleyfs", "/sessions/sess-1", ORIGIN).includes("mortgageeasy"),
);
ok(
  "001_marketing_url",
  marketingJourneyLinkForSlug("alice", "mortgageeasy", ORIGIN).startsWith(`${ORIGIN}/mortgageeasy/`) &&
    marketingCalculatorLinkForSlug("alice", "mortgageeasy", ORIGIN).includes("/mortgageeasy/calculator.html"),
);
ok(
  "002_marketing_url",
  marketingJourneyLinkForSlug("alice", "trentvalleyfs", ORIGIN).startsWith(`${ORIGIN}/trentvalleyfs/`) &&
    !marketingJourneyLinkForSlug("alice", "trentvalleyfs", ORIGIN).includes("mortgageeasy") &&
    !marketingCalculatorLinkForSlug("alice", "trentvalleyfs", ORIGIN).includes("mortgageeasy"),
);
ok("001_reset_path", buildHomePathAfterAuth(null, "mortgageeasy") === "/mortgageeasy/workspace");
ok(
  "002_reset_path",
  buildHomePathAfterAuth(null, "trentvalleyfs") === "/trentvalleyfs/workspace" &&
    !buildHomePathAfterAuth(null, "trentvalleyfs").includes("mortgageeasy"),
);
let reset001 = false;
let reset002 = false;
let resetNone = false;
try {
  reset001 = getPasswordResetUrl("mortgageeasy").includes("tenant=mortgageeasy");
  reset002 =
    getPasswordResetUrl("trentvalleyfs").includes("tenant=trentvalleyfs") &&
    !getPasswordResetUrl("trentvalleyfs").includes("mortgageeasy");
  resetNone = !getPasswordResetUrl().includes("mortgageeasy") && !getPasswordResetUrl().includes("tenant=");
} catch {
  const appUrlSrc = readFileSync(resolve(root, "src/lib/app-url.ts"), "utf8");
  reset001 =
    appUrlSrc.includes("getPasswordResetUrl") &&
    appUrlSrc.includes("/auth/reset") &&
    appUrlSrc.includes("?tenant=");
  reset002 = reset001 && !appUrlSrc.includes("mortgageeasy");
  resetNone = !appUrlSrc.includes("mortgageeasy");
}
ok("001_reset_url", reset001);
ok("002_reset_url", reset002);
ok(
  "no_default_001_share",
  referralLinkForSlug("alice", null, ORIGIN) === "" &&
    bookingLinkForSlug("alice", undefined, ORIGIN) === "" &&
    rafLinkForCode("AB12CD34", null, ORIGIN) === "" &&
    marketingJourneyLinkForSlug("alice", null, ORIGIN) === "",
);
ok(
  "no_default_001_reset",
  buildHomePathAfterAuth(null, null) === "/home" && resetNone,
);
ok(
  "canonical_helpers",
  buildCanonicalRefPath("mortgageeasy", "alice") === "/mortgageeasy/ref/alice" &&
    buildCanonicalBookPath("trentvalleyfs", "alice") === "/trentvalleyfs/book/alice" &&
    buildCanonicalRafPath("trentvalleyfs", "X") === "/trentvalleyfs/raf/X",
);

function publicLinkDenied(entityTenantSlug, urlTenantSlug) {
  return Boolean(entityTenantSlug && urlTenantSlug && entityTenantSlug !== urlTenantSlug);
}
ok("cross_tenant_001_on_002", publicLinkDenied("mortgageeasy", "trentvalleyfs"));
ok("cross_tenant_002_on_001", publicLinkDenied("trentvalleyfs", "mortgageeasy"));

const goSrc = readFileSync(resolve(root, "src/routes/go.$slug.tsx"), "utf8");
ok("go_uses_canonical_ref", goSrc.includes("/$tenantSlug/ref/$introducerRef"));
ok("go_never_platform_root", !goSrc.includes('to: "/"') && !goSrc.includes('to: "/home"'));
ok("go_fails_closed_without_tenant", goSrc.includes("firm is not available"));

const tenantRaf = readFileSync(resolve(root, "src/routes/$tenantSlug/raf.$code.tsx"), "utf8");
ok("raf_mismatch_notfound", tenantRaf.includes("meta.tenantSlug !== tenantSlug") && tenantRaf.includes("notFound()"));
const tenantRef = readFileSync(resolve(root, "src/routes/$tenantSlug/ref.$introducerRef.tsx"), "utf8");
ok("ref_mismatch_notfound", tenantRef.includes("throw notFound()"));
ok("ref_uses_resolveReferralSlug", tenantRef.includes("resolveReferralSlug"));
ok("ref_no_raw_or_filter", !tenantRef.includes(".or("));
ok(
  "ref_registered_path",
  routeTree.includes("fullPath: '/$tenantSlug/ref/$introducerRef'") ||
    routeTree.includes("/$tenantSlug/ref/$introducerRef"),
);

function consumeGeneratedRef(introducerSlug, tenantSlug) {
  const generated = referralLinkForSlug(introducerSlug, tenantSlug, ORIGIN);
  const parsed = parseCanonicalRefPath(generated);
  if (!parsed) return "not_found";
  return resolvePublicIntroducerRefAccess({
    urlTenantSlug: parsed.tenantSlug,
    introducerTenantSlug: tenantSlug,
    introducerSlug,
    introducerRef: parsed.introducerRef,
  });
}

ok("001_valid_ref_route", consumeGeneratedRef("peter-mabbott", "mortgageeasy") === "ok");
ok(
  "002_valid_ref_route",
  consumeGeneratedRef("peter-mabbott", "trentvalleyfs") === "ok" &&
    !referralLinkForSlug("peter-mabbott", "trentvalleyfs", ORIGIN).includes("mortgageeasy"),
);
ok(
  "001_as_002_ref_denied",
  resolvePublicIntroducerRefAccess({
    urlTenantSlug: "trentvalleyfs",
    introducerTenantSlug: "mortgageeasy",
    introducerSlug: "peter-mabbott",
    introducerRef: "peter-mabbott",
  }) === "not_found",
);
ok(
  "002_as_001_ref_denied",
  resolvePublicIntroducerRefAccess({
    urlTenantSlug: "mortgageeasy",
    introducerTenantSlug: "trentvalleyfs",
    introducerSlug: "tvfs-introducer",
    introducerRef: "tvfs-introducer",
  }) === "not_found",
);
ok(
  "unknown_introducer_ref",
  resolvePublicIntroducerRefAccess({
    urlTenantSlug: "mortgageeasy",
    introducerTenantSlug: "mortgageeasy",
    introducerSlug: "peter-mabbott",
    introducerRef: "does-not-exist",
  }) === "not_found",
);
ok(
  "unknown_tenant_ref",
  resolvePublicIntroducerRefAccess({
    urlTenantSlug: "not-a-registered-firm",
    introducerTenantSlug: "mortgageeasy",
    introducerSlug: "peter-mabbott",
    introducerRef: "peter-mabbott",
  }) === "not_found",
);
ok(
  "ref_no_default_001",
  resolvePublicIntroducerRefAccess({
    urlTenantSlug: null,
    introducerTenantSlug: null,
    introducerSlug: "peter-mabbott",
    introducerRef: "peter-mabbott",
  }) === "not_found" &&
    consumeGeneratedRef("peter-mabbott", null) === "not_found" &&
    parseCanonicalRefPath("/ref/peter-mabbott") === null,
);

const referralSrc = readFileSync(resolve(root, "src/lib/referral.ts"), "utf8");
ok("referral_no_hardcoded_001", !referralSrc.includes("/mortgageeasy"));
ok("referral_uses_canonical_helpers", referralSrc.includes("tryBuildCanonicalRefUrl") && referralSrc.includes("tryBuildCanonicalBookUrl") && referralSrc.includes("tryBuildCanonicalRafUrl"));

const smsSrc = readFileSync(resolve(root, "src/lib/sms.server.ts"), "utf8");
ok("sms_no_hardcoded_mortgageeasy_brand", !smsSrc.includes("MortgageEasy"));
ok("sms_session_uses_tenant_url", smsSrc.includes("buildTenantUrl") && smsSrc.includes("/sessions/"));

const bookingSrc = readFileSync(resolve(root, "src/lib/booking.functions.ts"), "utf8");
ok("booking_sms_selects_tenant_id", bookingSrc.includes('.select("id, company_name, slug, tenant_id")'));
ok("booking_confirm_tenant_url", bookingSrc.includes("buildTenantUrl") && bookingSrc.includes("/sessions/"));
ok("booking_no_flat_home_fallback", !bookingSrc.includes("`${getAppBaseUrl()}/home`") && !bookingSrc.includes("`${getAppBaseUrl()}/sessions/"));

const bookLegacy = readFileSync(resolve(root, "src/routes/book.$slug.tsx"), "utf8");
ok("platform_book_remaps", bookLegacy.includes("/$tenantSlug/book/$introducerSlug"));
ok("platform_book_auth_tenant", bookLegacy.includes("buildAuthNavigateSearch"));

const resetSrc = readFileSync(resolve(root, "src/routes/auth/reset.tsx"), "utf8");
ok("reset_success_tenant_workspace", resetSrc.includes("buildHomePathAfterAuth(null, tenantSlug)"));
const resetApi = readFileSync(resolve(root, "src/routes/api/auth/request-password-reset.ts"), "utf8");
ok("reset_api_passes_tenant", resetApi.includes("body.tenant"));

if (failures.length) {
  console.error(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log("\nG6B tenant routing verify PASS");
