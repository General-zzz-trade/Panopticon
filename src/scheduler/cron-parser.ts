/**
 * Minimal cron parser. Supports:
 *   *        = every
 *   n        = exact value
 *   n,m      = list
 *   n-m      = range
 *   * /n     = step (every n) — no space in actual code
 *
 * Returns the next Date after `from` when the cron fires.
 * Supports special strings: @hourly, @daily, @weekly, @monthly
 */

const ALIASES: Record<string, string> = {
  "@hourly":  "0 * * * *",
  "@daily":   "0 0 * * *",
  "@weekly":  "0 0 * * 0",
  "@monthly": "0 0 1 * *"
};

export function nextCronDate(expr: string, from: Date = new Date()): Date {
  const resolved = ALIASES[expr.trim()] ?? expr;
  const fields = resolved.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`Invalid cron expression: "${expr}"`);

  const [minField, hourField, domField, monField, dowField] = fields;

  // Start 1 minute after `from`
  const candidate = new Date(from);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  // Search up to 1 year ahead
  const limit = new Date(from.getTime() + 366 * 24 * 60 * 60 * 1000);

  while (candidate < limit) {
    if (
      matches(candidate.getMonth() + 1, monField, 1, 12) &&
      matches(candidate.getDate(), domField, 1, 31) &&
      matches(candidate.getDay(), dowField, 0, 6) &&
      matches(candidate.getHours(), hourField, 0, 23) &&
      matches(candidate.getMinutes(), minField, 0, 59)
    ) {
      return new Date(candidate);
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  throw new Error(`No next date found within 1 year for cron: "${expr}"`);
}

function matches(value: number, field: string, min: number, max: number): boolean {
  if (field === "*") return true;
  for (const part of field.split(",")) {
    if (part.includes("/")) {
      const [rangeStr, stepStr] = part.split("/");
      const step = parseInt(stepStr, 10);
      const [lo, hi] = rangeStr === "*" ? [min, max] : rangeStr.split("-").map(Number);
      for (let v = lo; v <= hi; v += step) {
        if (v === value) return true;
      }
    } else if (part.includes("-")) {
      const [lo, hi] = part.split("-").map(Number);
      if (value >= lo && value <= hi) return true;
    } else {
      if (parseInt(part, 10) === value) return true;
    }
  }
  return false;
}

export function validateCronExpr(expr: string): { valid: boolean; error?: string } {
  if (ALIASES[expr.trim()]) return { valid: true };
  try {
    nextCronDate(expr, new Date());
    return { valid: true };
  } catch (e) {
    return { valid: false, error: e instanceof Error ? e.message : "invalid" };
  }
}
