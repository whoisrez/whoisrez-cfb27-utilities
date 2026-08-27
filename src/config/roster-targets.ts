export type RosterTargetGroup = {
  key: string;
  label: string;
  positions: readonly string[];
  target: number;
};

export const ROSTER_TARGETS: readonly RosterTargetGroup[] = [
  { key: 'QB', label: 'Quarterback', positions: ['QB'], target: 4 },
  { key: 'HB', label: 'Running Back', positions: ['HB'], target: 4 },
  { key: 'FB', label: 'Full Back', positions: ['FB'], target: 1 },
  { key: 'WR', label: 'Wide Receiver', positions: ['WR'], target: 8 },
  { key: 'TE', label: 'Tight End', positions: ['TE'], target: 4 },
  { key: 'C', label: 'Center', positions: ['C'], target: 4 },
  { key: 'OG', label: 'Offensive Guard', positions: ['LG', 'RG'], target: 8 },
  { key: 'OT', label: 'Offensive Tackle', positions: ['LT', 'RT'], target: 8 },
  { key: 'EDGE', label: 'Edge', positions: ['LE', 'RE'], target: 8 },
  { key: 'DT', label: 'Defensive Tackle', positions: ['DT'], target: 4 },
  { key: 'MIKE', label: 'Mike Linebacker', positions: ['MIKE'], target: 4 },
  { key: 'SAM/WILL', label: 'Sam/Will Linebacker', positions: ['SAM', 'WILL'], target: 8 },
  { key: 'CB', label: 'Cornerback', positions: ['CB'], target: 8 },
  { key: 'FS', label: 'Free Safety', positions: ['FS'], target: 4 },
  { key: 'SS', label: 'Strong Safety', positions: ['SS'], target: 4 },
  { key: 'K', label: 'Kicker', positions: ['K'], target: 2 },
  { key: 'P', label: 'Punter', positions: ['P'], target: 2 },
] as const;

export const ROSTER_TARGET_TOTAL = ROSTER_TARGETS.reduce((sum, group) => sum + group.target, 0);
