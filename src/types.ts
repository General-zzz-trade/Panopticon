import type { BrowserSession } from "./browser";
import type { AppProcessHandle } from "./shell";
import type {
  AgentObservation,
  BeliefUpdate,
  CognitiveDecision,
  ExperimentResult,
  EpisodeEvent,
  FailureHypothesis,
  VerificationResult,
  WorldStateSnapshot
} from "./cognition/types";

export interface ScreencastSession {
  stop: () => Promise<void>;
}

export type TaskStatus = "pending" | "running" | "done" | "failed";

export type AgentAction =
  | "start_app"
  | "wait_for_server"
  | "open_page"
  | "click"
  | "type"
  | "select"
  | "scroll"
  | "hover"
  | "wait"
  | "assert_text"
  | "screenshot"
  | "stop_app"
  // Visual perception actions — use natural language description instead of CSS selector
  | "visual_click"
  | "visual_type"
  | "visual_assert"
  | "visual_extract"
  | "http_request"
  | "read_file"
  | "write_file"
  // Code execution
  | "run_code"
  // Email actions
  | "send_email"
  | "read_email"
  // OSINT reconnaissance actions
  | "osint_investigate"
  | "osint_domain"
  | "osint_network"
  | "osint_identity"
  | "osint_web"
  | "osint_threat"
  | "osint_asn"
  | "osint_crawl"
  | "osint_breach"
  | "osint_screenshot";

export type GoalCategory = "explicit" | "semi-natural" | "ambiguous";
export type EscalationStage = "planner" | "replanner" | "diagnoser";
export type EscalationPolicyMode = "conservative" | "balanced" | "aggressive";
export type FailureType =
  | "none"
  | "selector_mismatch"
  | "timeout"
  | "empty_response"
  | "invalid_json"
  | "low_quality_output"
  | "assert_mismatch"
  | "provider_unavailable"
  | "repeated_failure"
  | "unknown";

export interface AgentTask {
  id: string;
  type: AgentAction;
  status: TaskStatus;
  retries: number;
  attempts: number;
  replanDepth: number;
  payload: Record<string, string | number | boolean | undefined>;
  dependsOn?: string[];   // task ids that must complete before this one runs
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  error?: string;
  errorHistory?: string[];
}

export type TerminationReason =
  | "success"
  | "task_failure"
  | "replan_budget_exceeded"
  | "task_replan_budget_exceeded"
  | "timeout"
  | "cancelled"
  | "unknown";

export interface RunArtifact {
  type: string;
  path: string;
  description: string;
  taskId?: string;
}

export interface RunResult {
  success: boolean;
  message: string;
  error?: string;
}

export interface ReflectionResult {
  success: boolean;
  summary: string;
  diagnosis: string;
  topRisks?: string[];
  suggestedNextImprovements?: string[];
  improvementSuggestions: string[];
}

export interface PlanQualitySummary {
  complete: boolean;
  score: number;
  quality: "high" | "medium" | "low";
  issues: string[];
}

export interface PlannerCandidateTrace {
  planner: "template" | "regex" | "llm";
  qualitySummary: PlanQualitySummary;
  taskCount: number;
  valid: boolean;
  triggerReason?: string;
  timeout: boolean;
  fallbackReason?: string;
  priorAwarePlanning?: PriorAwarePlanningTrace;
}

export interface PlanningPriorHit {
  taskType: string;
  recovery: string;
  hypothesisKind?: string;
  domain?: string;
  recoverySequence?: string[];
}

export interface PriorAwarePlanningTrace {
  applied: boolean;
  notes: string[];
  matchedPriors: PlanningPriorHit[];
  originalTaskCount: number;
  rewrittenTaskCount: number;
  qualityDelta?: number;
}

export interface ProviderCapabilityHealth {
  configured: boolean;
  healthy: boolean;
  rationale: string;
}

export interface ProviderHealth {
  planner: ProviderCapabilityHealth;
  replanner: ProviderCapabilityHealth;
  diagnoser: ProviderCapabilityHealth;
}

export interface FailurePatternSummary {
  taskType: AgentAction;
  count: number;
}

export interface EscalationPolicyDecision {
  useRulePlanner: boolean;
  useLLMPlanner: boolean;
  useRuleReplanner: boolean;
  useLLMReplanner: boolean;
  useRuleDiagnoser: boolean;
  useLLMDiagnoser: boolean;
  fallbackToRules: boolean;
  abortEarly: boolean;
  rationale: string[];
  llmUsageRationale?: string;
  fallbackRationale?: string;
}

export interface EscalationDecisionTrace {
  stage: EscalationStage;
  taskId?: string;
  goalCategory: GoalCategory;
  plannerQuality: PlanQualitySummary["quality"] | "unknown";
  currentFailureType: FailureType;
  failurePatterns: FailurePatternSummary[];
  policyMode: EscalationPolicyMode;
  providerHealth: ProviderHealth;
  decision: EscalationPolicyDecision;
  timestamp: string;
}

export interface PlannerDecisionTrace {
  candidatePlanners: PlannerCandidateTrace[];
  chosenPlanner: "template" | "regex" | "llm" | "none";
  qualitySummary: PlanQualitySummary;
  qualityScore: number;
  goalCategory: GoalCategory;
  policyMode: EscalationPolicyMode;
  triggerReason?: string;
  fallbackReason?: string;
  llmUsageRationale?: string;
  fallbackRationale?: string;
  escalationDecision: EscalationDecisionTrace;
  llmInvocations: number;
  llmUsageCap: number;
  timeoutCount: number;
  chosenPriorAwarePlanning?: PriorAwarePlanningTrace;
}

export interface PlannerTieBreakerPolicy {
  preferStablePlannerOnTie: boolean;
  preferRulePlannerOnTie: boolean;
  preferLowerTaskCountOnTie: boolean;
}

export interface AgentPolicy {
  mode: EscalationPolicyMode;
  plannerCostMode: EscalationPolicyMode;
  replannerCostMode: EscalationPolicyMode;
  preferRuleSystemsOnCheapGoals: boolean;
  allowLLMReplannerForSimpleFailures: boolean;
  approval?: {
    enabled: boolean;
    requireApproval: string[];
    autoApproveTimeout?: number;
  };
}

export interface UsageLedger {
  rulePlannerAttempts: number;
  llmPlannerCalls: number;
  ruleReplannerAttempts: number;
  llmReplannerCalls: number;
  llmDiagnoserCalls: number;
  plannerTimeouts: number;
  replannerTimeouts: number;
  diagnoserTimeouts: number;
  plannerFallbacks: number;
  replannerFallbacks: number;
  totalLLMInteractions: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export interface RunMetrics {
  totalTasks: number;
  doneTasks: number;
  failedTasks: number;
  totalRetries: number;
  totalReplans: number;
  averageTaskDurationMs: number;
}

export interface RunLimits {
  maxReplansPerRun: number;
  maxReplansPerTask: number;
}

export interface RunContext {
  runId: string;
  tenantId?: string;
  plannerUsed?: "template" | "regex" | "llm" | "none";
  plannerDecisionTrace?: PlannerDecisionTrace;
  plannerTieBreakerPolicy?: PlannerTieBreakerPolicy;
  policy?: AgentPolicy;
  usageLedger?: UsageLedger;
  escalationDecisions: EscalationDecisionTrace[];
  goal: string;
  tasks: AgentTask[];
  artifacts: RunArtifact[];
  replanCount: number;
  nextTaskSequence: number;
  insertedTaskCount: number;
  llmReplannerInvocations: number;
  llmReplannerTimeoutCount: number;
  llmReplannerFallbackCount: number;
  limits: RunLimits;
  startedAt: string;
  endedAt?: string;
  browserSession?: BrowserSession;
  screencastSession?: ScreencastSession;
  appProcess?: AppProcessHandle;
  worldState?: WorldStateSnapshot;
  worldStateHistory?: WorldStateSnapshot[];
  observations?: AgentObservation[];
  latestObservation?: AgentObservation;
  hypotheses?: FailureHypothesis[];
  experimentResults?: ExperimentResult[];
  beliefUpdates?: BeliefUpdate[];
  episodeEvents?: EpisodeEvent[];
  verificationResults?: VerificationResult[];
  cognitiveDecisions?: CognitiveDecision[];
  metrics?: RunMetrics;
  terminationReason?: TerminationReason;
  result?: RunResult;
  reflection?: ReflectionResult;
}
