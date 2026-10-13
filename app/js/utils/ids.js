// Stable, collision-resistant IDs for events, sessions, buses and participants.
// Format: "<prefix>_<16 hex chars>" — short enough to read in a backup file,
// random enough to merge data from several devices later (Phase 2).

function randomHex(bytes) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function newId(prefix) {
  return `${prefix}_${randomHex(8)}`;
}
