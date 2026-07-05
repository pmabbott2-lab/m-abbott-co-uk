const STORAGE_KEY = "mortgage-hub:advisor-view";

export type AdvisorViewState = {
  advisorId: string;
  advisorName: string;
};

export function getAdvisorView(): AdvisorViewState | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AdvisorViewState;
    if (!parsed.advisorId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setAdvisorView(state: AdvisorViewState): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearAdvisorView(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}
