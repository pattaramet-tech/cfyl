// Client-side Quick Result local draft autosave (Phase 5b, Stage A). Scoped
// strictly by tournamentId/venueId/matchId so a draft never leaks into a
// different match. Survives refresh/tab-close via localStorage — this file
// must only be imported from client components ('use client').

export interface QuickResultDraft {
  tournamentId: string;
  venueId: string;
  matchId: string;
  homeScore: string;
  awayScore: string;
  matchVersion: number;
  savedAt: string;
}

const STORAGE_PREFIX = 'tournament_v2_quick_result_draft';

function draftKey(tournamentId: string, venueId: string, matchId: string): string {
  return `${STORAGE_PREFIX}:${tournamentId}:${venueId}:${matchId}`;
}

export function saveLocalDraft(draft: QuickResultDraft): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(draftKey(draft.tournamentId, draft.venueId, draft.matchId), JSON.stringify(draft));
  } catch {
    // Storage full or unavailable — draft persistence is best-effort, never fatal.
  }
}

export function loadLocalDraft(tournamentId: string, venueId: string, matchId: string): QuickResultDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(draftKey(tournamentId, venueId, matchId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as QuickResultDraft;
    if (parsed.tournamentId !== tournamentId || parsed.venueId !== venueId || parsed.matchId !== matchId) {
      // Defensive: never return a draft that doesn't match the requested scope.
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearLocalDraft(tournamentId: string, venueId: string, matchId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(draftKey(tournamentId, venueId, matchId));
  } catch {
    // best-effort
  }
}
