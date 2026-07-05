export type ExportSheet = {
  name: string;
  headers: string[];
  rows: (string | number | null | undefined)[][];
};

export type OwnerCustomerExportRow = {
  customerId: string;
  fullName: string;
  email: string;
  phone: string;
  address: string;
  introducer: string;
  caseRefs: string;
  caseCount: number;
  factFindCount: number;
  latestStatus: string;
  assignedAdvisors: string;
  totalFeesGbp: string;
  advisorCommissionGbp: string;
  introducerCommissionGbp: string;
  pendingCommissionGbp: string;
  paidCommissionGbp: string;
};

export function penceToGbp(pence: number): string {
  return (pence / 100).toFixed(2);
}
