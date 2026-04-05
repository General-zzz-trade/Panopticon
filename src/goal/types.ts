/**
 * Goal Types — structured representation of agent goals.
 *
 * Transforms raw goal strings into verifiable, decomposable objects
 * with explicit success criteria and constraints.
 */

export type CriterionType =
  | "text_present"      // Expected text visible on page
  | "text_absent"       // Text must NOT be visible
  | "url_reached"       // Page URL contains/matches value
  | "element_exists"    // CSS selector exists in DOM
  | "state_reached"     // App state matches (e.g., "authenticated")
  | "http_status"       // HTTP response code
  | "file_exists"       // File at path exists
  | "custom";           // Free-form, verified by LLM

export interface SuccessCriterion {
  type: CriterionType;
  value: string;
  /** How confident we are this is a real criterion (1.0 = explicitly stated, 0.5 = inferred) */
  confidence: number;
  /** Source: "dsl" (regex-extracted) | "llm" (LLM-inferred) | "user" (explicitly stated) */
  source: "dsl" | "llm" | "user";
}

export type ConstraintType =
  | "max_steps"
  | "max_tokens"
  | "max_duration_ms"
  | "safe_only";

export interface GoalConstraint {
  type: ConstraintType;
  value: number | string;
}

export type GoalDifficulty = "trivial" | "simple" | "medium" | "complex" | "open-ended";

export interface Goal {
  /** Original user input */
  raw: string;
  /** Cleaned intent */
  intent: string;
  /** Verifiable success conditions */
  successCriteria: SuccessCriterion[];
  /** Execution constraints */
  constraints: GoalConstraint[];
  /** Recursive decomposition (populated by decomposer) */
  subGoals?: Goal[];
  /** Estimated difficulty */
  difficulty: GoalDifficulty;
}

/**
 * Result of verifying a goal against its criteria.
 */
export interface CriteriaVerificationResult {
  /** How many criteria were met */
  met: number;
  /** Total criteria count */
  total: number;
  /** Overall pass (all criteria met or ratio above threshold) */
  passed: boolean;
  /** Weighted confidence based on individual criterion confidences */
  confidence: number;
  /** Per-criterion results */
  details: Array<{
    criterion: SuccessCriterion;
    met: boolean;
    evidence: string;
  }>;
}
