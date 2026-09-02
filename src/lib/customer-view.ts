const STORAGE_KEY = "mortgage-hub:customer-view";

export type CustomerViewState = {
  customerId: string;
  customerName: string;
};

export function getCustomerView(): CustomerViewState | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CustomerViewState;
    if (!parsed.customerId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setCustomerView(state: CustomerViewState): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearCustomerView(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}
