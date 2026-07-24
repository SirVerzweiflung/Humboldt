// Player marker/dot colours. DOCUMENTED EXCEPTION to CLAUDE.md §15's 5-colour
// palette: you cannot tell ~20 players apart with 5 hues, and pins must be
// distinguishable on a projector. These apply ONLY to per-player markers/dots;
// every other surface stays strict palette. Assigned by join order (stable), so a
// player keeps the same colour for the whole quiz.
const PLAYER_COLORS = [
  "#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4",
  "#46f0f0", "#f032e6", "#bcf60c", "#fabebe", "#008080",
  "#e6beff", "#9a6324", "#800000", "#808000", "#000075",
  "#a9a9a9", "#ff4500", "#1e90ff", "#00ced1", "#c71585",
];

// index = position in join order (players sorted by joined_at).
export function colorForIndex(index: number): string {
  return PLAYER_COLORS[index % PLAYER_COLORS.length];
}

// Build a stable player-id → colour map from players already sorted by join time.
export function colorMap(playerIdsByJoin: string[]): Record<string, string> {
  const m: Record<string, string> = {};
  playerIdsByJoin.forEach((id, i) => (m[id] = colorForIndex(i)));
  return m;
}
