export type TeamNeedsDepartures = {
  transferring: number;
  projectedDraft: number;
  beingCut: number;
};

export function availableTeamNeedsDepartures(onTeam: number, graduating: number): number {
  const rosterCount = Number.isFinite(onTeam) ? Math.max(0, Math.trunc(onTeam)) : 0;
  const graduates = Number.isFinite(graduating) ? Math.max(0, Math.trunc(graduating)) : 0;
  return Math.max(0, rosterCount - Math.min(rosterCount, graduates));
}

export function clampTeamNeedsDeparture(value: unknown, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(Math.max(0, Math.trunc(max)), Math.trunc(parsed)));
}

export function normalizeTeamNeedsDepartures(
  onTeam: number,
  graduating: number,
  transferring: unknown,
  projectedDraft: unknown,
  beingCut: unknown,
): TeamNeedsDepartures {
  const available = availableTeamNeedsDepartures(onTeam, graduating);
  const normalizedTransferring = clampTeamNeedsDeparture(transferring, available);
  const normalizedProjectedDraft = clampTeamNeedsDeparture(projectedDraft, available - normalizedTransferring);
  const normalizedBeingCut = clampTeamNeedsDeparture(
    beingCut,
    available - normalizedTransferring - normalizedProjectedDraft,
  );
  return {
    transferring: normalizedTransferring,
    projectedDraft: normalizedProjectedDraft,
    beingCut: normalizedBeingCut,
  };
}

export function calculateTeamNeedsStillNeeded(
  target: number,
  onTeam: number,
  graduating: number,
  transferring: number,
  projectedDraft: number,
  beingCut: number,
  recruited: number,
): number {
  const available = availableTeamNeedsDepartures(onTeam, graduating);
  const normalized = normalizeTeamNeedsDepartures(
    onTeam,
    graduating,
    transferring,
    projectedDraft,
    beingCut,
  );
  const recruits = Number.isFinite(recruited) ? Math.max(0, Math.trunc(recruited)) : 0;
  const projected = Math.max(
    0,
    available - normalized.transferring - normalized.projectedDraft - normalized.beingCut + recruits,
  );
  return Math.trunc(target) - projected;
}
