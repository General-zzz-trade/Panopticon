import type { BrowserSession } from "./browser";
import type { AppProcessHandle } from "./shell";

export type TaskStatus = "pending" | "running" | "done" | "failed";

export type AgentAction =
  | "start_app"
  | "wait_for_server"
  | "open_page"
  | "click"
  | "wait"
  | "assert_text"
  | "screenshot"
  | "stop_app";

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

export interface EscalationTraceRecord {
  stage: "planner" | "replanner" | "diagnoser";
  decision: {
    useRulePlanner: boolean;
    useLLMPlanner: boolean;
    useRuleReplanner: boolean;
    useLLMReplanner: boolean;
    fallbackToRules: boolean;
    abortEarly: boolean;
    useDiagnoser: boolean;
  };
  llmUsageRationale: string;
  fallbackRationale: string;
}

export interface PlannerDecisionTrace {
  candidatePlanners: PlannerCandidateTrace[];
  chosenPlanner: "template" | "regex" | "llm" | "none";
  qualitySummary: PlanQualitySummary;
  qualityScore: number;
  triggerReason?: string;
  fallbackReason?: string;
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
  plannerCostMode: "conservative" | "balanced" | "aggressive";
  replannerCostMode: "conservative" | "balanced" | "aggressive";
  preferRuleSystemsOnCheapGoals: boolean;
  allowLLMReplannerForSimpleFailures: boolean;
}

export interface UsageLedger {
  rulePlannerAttempts: number;
  llmPlannerCalls: number;
  ruleReplannerAttempts: number;
  llmReplannerCalls: number;
  llmDiagnoserCalls: number;
  plannerCalls: number;
  replannerCalls: number;
  diagnoserCalls: number;
  plannerTimeouts: number;
  replannerTimeouts: number;
  fallbackCounts: number;
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
  escalationTrace?: EscalationTraceRecord[];
  plannerDecisionTrace?: PlannerDecisionTrace;
  plannerTieBreakerPolicy?: PlannerTieBreakerPolicy;
  policy?: AgentPolicy;
  usageLedger?: UsageLedger;
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
