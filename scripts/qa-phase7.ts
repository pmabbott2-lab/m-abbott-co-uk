/**
 * Phase 7 — role visibility + export regression checks.
 * Run: npm run test:qa
 */
import assert from "node:assert/strict";
import {
  emptyPermissions,
  fullPermissions,
  type AdminAccess,
} from "../src/lib/admin-access";
import {
  countStaffBranches,
  getStaffBranchVisibility,
  type StaffBranchNavContext,
} from "../src/lib/staff-branch-nav";
import {
  commissionAnnualBreakdownToSheet,
  commissionPipelineSummaryToSheet,
  commissionRowsToSheet,
  customerReportToSheet,
  ledgerRowsToSheet,
  viewAsAuditToSheet,
} from "../src/lib/report-mappers";
import { safeFormat } from "../src/lib/safe-format";
import type { CommissionPayoutRow } from "../src/lib/finance.functions";

let passed = 0;

function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function ownerAccess(): AdminAccess {
  return {
    isAdmin: true,
    adminLevel: "owner",
    isOwner: true,
    isSupervisor: false,
    permissions: fullPermissions(),
  };
}

function supervisorAccess(): AdminAccess {
  return {
    isAdmin: true,
    adminLevel: "supervisor",
    isOwner: false,
    isSupervisor: true,
    permissions: fullPermissions(),
  };
}

function generalAdminAccess(
  permissions: AdminAccess["permissions"],
): AdminAccess {
  return {
    isAdmin: true,
    adminLevel: "general",
    isOwner: false,
    isSupervisor: false,
    permissions,
  };
}

function vis(partial: StaffBranchNavContext) {
  return getStaffBranchVisibility(partial);
}

console.log("\nRole visibility QA\n");

test("owner: customers, diary (filtered + all), management, finance (not my commission)", () => {
  const v = vis({
    isAdvisor: true,
    isMainAdmin: true,
    isOwner: true,
    isSupervisor: false,
    isIntroducer: false,
    adminAccess: ownerAccess(),
  });
  assert.equal(v.branches.customers, true);
  assert.equal(v.branches.diary, true);
  assert.equal(v.branches.management, true);
  assert.equal(v.diary.myDiary, true);
  assert.equal(v.diary.allAppointments, true);
  assert.equal(v.finance.myCommission, false);
  assert.equal(v.finance.commissionMgmt, true);
  assert.equal(v.finance.financeReport, true);
  assert.equal(v.management.view, true);
  assert.equal(v.management.manageTeamRoles, true);
  assert.equal(v.branches.introducers, false);
});

test("supervisor: diary + management, no finance report", () => {
  const v = vis({
    isAdvisor: false,
    isMainAdmin: true,
    isOwner: false,
    isSupervisor: true,
    isIntroducer: false,
    adminAccess: supervisorAccess(),
  });
  assert.equal(v.branches.diary, true);
  assert.equal(v.branches.management, true);
  assert.equal(v.finance.financeReport, false);
  assert.equal(v.finance.myCommission, false);
  assert.equal(v.finance.commissionMgmt, true);
});

test("pure advisor: customers, diary (own only), my commission — no management", () => {
  const v = vis({
    isAdvisor: true,
    isMainAdmin: false,
    isOwner: false,
    isSupervisor: false,
    isIntroducer: false,
    adminAccess: null,
  });
  assert.equal(v.branches.customers, true);
  assert.equal(v.branches.diary, true);
  assert.equal(v.diary.myDiary, true);
  assert.equal(v.diary.allAppointments, false);
  assert.equal(v.finance.myCommission, true);
  assert.equal(v.branches.management, false);
  assert.equal(countStaffBranches(v), 3);
});

test("general admin customers-only: single Customers top tab", () => {
  const perms = emptyPermissions();
  perms.customers = "amend";
  const v = vis({
    isAdvisor: false,
    isMainAdmin: true,
    isOwner: false,
    isSupervisor: false,
    isIntroducer: false,
    adminAccess: generalAdminAccess(perms),
  });
  assert.equal(v.branches.customers, true);
  assert.equal(v.customers.list, true);
  assert.equal(v.customers.contacts, false);
  assert.equal(v.branches.diary, false);
  assert.equal(v.branches.management, false);
  assert.equal(v.branches.finance, false);
  assert.equal(countStaffBranches(v), 1);
});

test("general admin appointments-only: Contacts + Diary tabs", () => {
  const perms = emptyPermissions();
  perms.appointments = "view";
  const v = vis({
    isAdvisor: false,
    isMainAdmin: true,
    isOwner: false,
    isSupervisor: false,
    isIntroducer: false,
    adminAccess: generalAdminAccess(perms),
  });
  assert.equal(v.branches.customers, true);
  assert.equal(v.customers.list, false);
  assert.equal(v.customers.contacts, true);
  assert.equal(v.branches.diary, true);
  assert.equal(v.diary.allAppointments, true);
  assert.equal(v.branches.management, false);
  assert.equal(countStaffBranches(v), 2);
});

test("general admin advisors perm: diary filtered + team roles under manage", () => {
  const perms = emptyPermissions();
  perms.advisors = "view";
  const v = vis({
    isAdvisor: false,
    isMainAdmin: true,
    isOwner: false,
    isSupervisor: false,
    isIntroducer: false,
    adminAccess: generalAdminAccess(perms),
  });
  assert.equal(v.branches.diary, true);
  assert.equal(v.diary.allAppointments, true);
  assert.equal(v.management.manageTeamRoles, true);
  assert.equal(v.management.advisorCommission, true);
});

test("introducer-only: Introducers tab, no customer staff branches", () => {
  const v = vis({
    isAdvisor: false,
    isMainAdmin: false,
    isOwner: false,
    isSupervisor: false,
    isIntroducer: true,
    adminAccess: null,
  });
  assert.equal(v.branches.introducers, true);
  assert.equal(v.branches.customers, false);
  assert.equal(v.branches.management, false);
});

test("owner with introducer role: no top Introducers tab", () => {
  const v = vis({
    isAdvisor: true,
    isMainAdmin: true,
    isOwner: true,
    isSupervisor: false,
    isIntroducer: true,
    adminAccess: ownerAccess(),
  });
  assert.equal(v.branches.introducers, false);
});

console.log("\nExport mapper regression\n");

test("safeFormat handles invalid dates without throwing", () => {
  assert.equal(safeFormat("not-a-date", "yyyy-MM-dd"), "—");
  assert.equal(safeFormat(null, "HH:mm"), "—");
  assert.equal(safeFormat("2026-09-02T10:00:00Z", "yyyy-MM-dd"), "2026-09-02");
});

test("ledgerRowsToSheet maps rows with stable column count", () => {
  const sheet = ledgerRowsToSheet([
    {
      created_at: "bad",
      kind: "fee",
      amount_pence: 15000,
    },
    {
      created_at: "2026-09-02T12:00:00Z",
      kind: "commission",
      amount_pence: 5000,
      customerName: "Test",
    },
  ]);
  assert.equal(sheet.headers.length, 10);
  for (const row of sheet.rows) {
    assert.equal(row.length, sheet.headers.length);
  }
  assert.equal(sheet.rows[0][0], "—");
});

test("commissionRowsToSheet handles empty and populated rows", () => {
  const empty = commissionRowsToSheet([]);
  assert.equal(empty.rows.length, 0);
  const row: CommissionPayoutRow = {
    id: "1",
    createdAt: "2026-09-01T00:00:00Z",
    beneficiaryRole: "advisor",
    beneficiaryName: "Advisor",
    beneficiaryUserId: "u1",
    sessionId: "s1",
    caseRef: "CASE-1",
    feeType: "fee",
    commissionPct: 10,
    amountPence: 10000,
    payoutStatus: "pending",
    payoutAt: null,
  };
  const sheet = commissionRowsToSheet([row]);
  assert.equal(sheet.rows.length, 1);
  assert.equal(sheet.rows[0].length, sheet.headers.length);
});

test("customerReportToSheet column alignment", () => {
  const sheet = customerReportToSheet([
    {
      fullName: "Jane",
      email: "j@test.co.uk",
      phone: "07123456789",
      address: "1 High St",
      introducer: "Intro",
      caseRefs: "C-1",
      caseCount: 1,
      factFindCount: 1,
      latestStatus: "submitted",
      assignedAdvisors: "Advisor",
      totalFeesGbp: "100.00",
      advisorCommissionGbp: "10.00",
      introducerCommissionGbp: "5.00",
      pendingCommissionGbp: "10.00",
      paidCommissionGbp: "0.00",
    },
  ]);
  assert.equal(sheet.rows[0].length, sheet.headers.length);
});

test("commission pipeline + annual export sheets", () => {
  const pipeline = commissionPipelineSummaryToSheet([]);
  assert.equal(pipeline.rows.length, 3);
  const annual = commissionAnnualBreakdownToSheet([
    {
      key: "2026-09",
      label: "Sep 2026",
      totals: {
        pending: { count: 1, amountPence: 100 },
        received: { count: 0, amountPence: 0 },
        paid: { count: 0, amountPence: 0 },
        rejected: { count: 0, amountPence: 0 },
        lost: { count: 0, amountPence: 0 },
      },
    },
  ]);
  assert.equal(annual.rows[0].length, annual.headers.length);
});

test("viewAsAuditToSheet handles invalid timestamps", () => {
  const sheet = viewAsAuditToSheet([
    { created_at: "invalid", action: "open", summary: "Opened", view_type: "advisor" },
  ]);
  assert.equal(sheet.rows[0][0], "—");
});

console.log(`\n${passed} checks passed.\n`);
