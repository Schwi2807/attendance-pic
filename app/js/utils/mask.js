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

/**
 * Phone numbers under the same privacy setting: keep the first 3 and the
 * last 2 digits, mask the rest, keep spaces/dashes ("012-555 1000" →
 * "012-••• ••00").
 */
export function maskPhone(phone) {
  const s = String(phone ?? '').trim();
  const digits = s.replace(/\D/g, '').length;
  if (!digits) return s;
  let seen = 0;
  return s.replace(/\d/g, (d) => {
    seen++;
    return seen <= 3 || seen > digits - 2 ? d : MASK_CHAR;
  });
}
