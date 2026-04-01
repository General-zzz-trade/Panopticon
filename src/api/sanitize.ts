// Sanitize goal strings before passing to the planner.
// Goals are natural language — we only strip null bytes and control characters
// that have no legitimate use in goal descriptions, and enforce a length cap.

const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
const MAX_GOAL_LENGTH = 2000;

export function sanitizeGoal(raw: string): string {
  return raw.replace(CONTROL_CHARS, "").trim().slice(0, MAX_GOAL_LENGTH);
}

// Validate that a selector looks like a CSS selector and not an injection attempt.
// Rejects selectors containing script-like patterns (e.g., javascript:, <script>).
const DANGEROUS_SELECTOR = /<|javascript\s*:/i;

export function isSafeSelector(selector: string): boolean {
  if (!selector || selector.length > 500) return false;
  return !DANGEROUS_SELECTOR.test(selector);
}
