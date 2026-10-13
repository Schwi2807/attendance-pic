// The ONE place that decides how a student ID is shown when it must not be
// shown in full (e.g. "AD250001" -> "AD••••••").
//
// Phase 1 uses it for the optional "Mask IDs on screen" setting. In Phase 2
// the same rule moves server-side (a Postgres view / RPC) so other students
// never receive the full ID; keep this function as the single source of truth
// for the display format.

const MASK_CHAR = '•';

export function maskId(id) {
  const s = String(id ?? '').trim();
  if (!s) return '';
  // Keep the leading letters (faculty / programme prefix, max 3), mask the rest.
  const prefix = (s.match(/^[A-Za-z]{1,3}/) || [''])[0];
  const keep = prefix.length || Math.min(2, Math.max(0, s.length - 4));
  return s.slice(0, keep) + MASK_CHAR.repeat(Math.max(s.length - keep, 1));
}
