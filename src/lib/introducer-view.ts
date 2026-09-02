const STORAGE_KEY = "mortgage-hub:introducer-view";

export type IntroducerViewState = {
  userId: string;
  introducerName: string;
  companyName?: string | null;
};

export function getIntroducerView(): IntroducerViewState | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as IntroducerViewState;
    if (!parsed.userId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setIntroducerView(state: IntroducerViewState): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearIntroducerView(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}
