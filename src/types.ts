import type { BrowserSession } from "./browser";
import type { AppProcessHandle } from "./shell";

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
  | "visual_extract";

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
  appProcess?: AppProcessHandle;
  metrics?: RunMetrics;
  terminationReason?: TerminationReason;
  result?: RunResult;
  reflection?: ReflectionResult;
}
