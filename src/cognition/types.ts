export type CognitiveStepKind =
  | "observe"
  | "execute"
  | "hypothesize"
  | "experiment"
  | "verify"
  | "recover"
  | "abort";

export type WorldStateAppState =
  | "unknown"
  | "loading"
  | "ready"
  | "authenticated"
  | "error";

export type VerifierKind = "action" | "state" | "goal";
export type ObservationSource = "task_observe" | "experiment_refresh" | "recovery_followup";

export interface ActionableElementObservation {
  role?: string;
  text?: string;
  selector?: string;
  confidence: number;
}

export interface AgentObservation {
  id: string;
  runId: string;
  taskId?: string;
  timestamp: string;
  source: ObservationSource;
  pageUrl?: string;
  title?: string;
  visibleText?: string[];
  actionableElements?: ActionableElementObservation[];
  appStateGuess?: string;
  anomalies: string[];
  confidence: number;
}

export interface ObservationPatch {
  pageUrl?: string;
  title?: string;
  visibleText?: string[];
  appStateGuess?: string;
  anomalies?: string[];
  confidence?: number;
}

export interface WorldStateSnapshot {
  runId: string;
  timestamp: string;
  source?: ObservationSource | "state_update";
  reason?: string;
  pageUrl?: string;
  appState: WorldStateAppState;
  lastAction?: string;
  lastObservationId?: string;
  uncertaintyScore: number;
  facts: string[];
}

export interface VerificationResult {
  runId: string;
  taskId?: string;
  verifier: VerifierKind;
  passed: boolean;
  confidence: number;
  rationale: string;
  evidence: string[];
}

export interface EpisodeEvent {
  id: string;
  runId: string;
  taskId?: string;
  kind: CognitiveStepKind;
  timestamp: string;
  summary: string;
  observationId?: string;
  verificationPassed?: boolean;
  metadata?: Record<string, string | number | boolean>;
}

export interface CognitiveDecision {
  nextAction: "continue" | "retry_task" | "reobserve" | "replan" | "abort";
  rationale: string;
  confidence: number;
}

export type FailureHypothesisKind =
  | "state_not_ready"
  | "selector_drift"
  | "assertion_phrase_changed"
  | "session_not_established"
  | "missing_page_context"
  | "learned_pattern"
  | "unknown";

export interface FailureHypothesis {
  id: string;
  taskId?: string;
  kind: FailureHypothesisKind;
  explanation: string;
  confidence: number;
  suggestedExperiments: string[];
  recoveryHint: string;
}

export interface ExperimentResult {
  id: string;
  runId: string;
  taskId?: string;
  hypothesisId: string;
  experiment: string;
  performedAction?: string;
  outcome: "support" | "refute" | "inconclusive";
  evidence: string[];
  confidenceDelta: number;
  observationPatch?: ObservationPatch;
  stateHints?: string[];
}

export interface BeliefUpdate {
  id: string;
  runId: string;
  taskId?: string;
  hypothesisId: string;
  previousConfidence: number;
  nextConfidence: number;
  rationale: string;
}

export interface ObservationInput {
  runId: string;
  taskId?: string;
  source?: ObservationSource;
  pageUrl?: string;
  title?: string;
  visibleText?: string[];
  actionableElements?: ActionableElementObservation[];
  appStateGuess?: string;
  anomalies?: string[];
  confidence?: number;
}
