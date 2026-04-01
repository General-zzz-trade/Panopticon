import { RunContext, UsageLedger } from "./types";

export function createUsageLedger(): UsageLedger {
  return {
    rulePlannerAttempts: 0,
    llmPlannerCalls: 0,
    ruleReplannerAttempts: 0,
    llmReplannerCalls: 0,
    llmDiagnoserCalls: 0,
    plannerCalls: 0,
    replannerCalls: 0,
    diagnoserCalls: 0,
    plannerTimeouts: 0,
    replannerTimeouts: 0,
    fallbackCounts: 0,
    plannerFallbacks: 0,
    replannerFallbacks: 0,
    totalLLMInteractions: 0
  };
}

export function finalizeUsageLedger(context: RunContext): UsageLedger {
  const ledger = context.usageLedger ?? createUsageLedger();
  ledger.plannerCalls = ledger.llmPlannerCalls;
  ledger.replannerCalls = ledger.llmReplannerCalls;
  ledger.diagnoserCalls = ledger.llmDiagnoserCalls;
  ledger.totalLLMInteractions = ledger.llmPlannerCalls + ledger.llmReplannerCalls + ledger.llmDiagnoserCalls;
  context.usageLedger = ledger;
  return ledger;
}

export function recordRulePlannerAttempt(context: RunContext): void {
  ensureLedger(context).rulePlannerAttempts += 1;
}

export function recordPlannerCall(context: RunContext): void {
  ensureLedger(context).llmPlannerCalls += 1;
}

export function recordRuleReplannerAttempt(context: RunContext): void {
  ensureLedger(context).ruleReplannerAttempts += 1;
}

export function recordReplannerCall(context: RunContext): void {
  ensureLedger(context).llmReplannerCalls += 1;
}

export function recordDiagnoserCall(context: RunContext): void {
  ensureLedger(context).llmDiagnoserCalls += 1;
}

export function recordPlannerTimeout(context: RunContext): void {
  ensureLedger(context).plannerTimeouts += 1;
}

export function recordReplannerTimeout(context: RunContext): void {
  ensureLedger(context).replannerTimeouts += 1;
}

export function recordPlannerFallback(context: RunContext): void {
  const ledger = ensureLedger(context);
  ledger.fallbackCounts += 1;
  ledger.plannerFallbacks += 1;
}

export function recordReplannerFallback(context: RunContext): void {
  const ledger = ensureLedger(context);
  ledger.fallbackCounts += 1;
  ledger.replannerFallbacks += 1;
}

function ensureLedger(context: RunContext): UsageLedger {
  if (!context.usageLedger) {
    context.usageLedger = createUsageLedger();
  }

  return context.usageLedger;
}
