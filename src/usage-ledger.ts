import { RunContext, UsageLedger } from "./types";

export function createUsageLedger(): UsageLedger {
  return {
    rulePlannerAttempts: 0,
    llmPlannerCalls: 0,
    ruleReplannerAttempts: 0,
    llmReplannerCalls: 0,
    llmDiagnoserCalls: 0,
    plannerTimeouts: 0,
    replannerTimeouts: 0,
    diagnoserTimeouts: 0,
    plannerFallbacks: 0,
    replannerFallbacks: 0,
    totalLLMInteractions: 0
  };
}

export function finalizeUsageLedger(context: RunContext): UsageLedger {
  const ledger = context.usageLedger ?? createUsageLedger();
  ledger.totalLLMInteractions = ledger.llmPlannerCalls + ledger.llmReplannerCalls + ledger.llmDiagnoserCalls;
  context.usageLedger = ledger;
  return ledger;
}

export function recordRulePlannerAttempt(context: RunContext | { usageLedger?: UsageLedger }): void {
  ensureLedger(context).rulePlannerAttempts += 1;
}

export function recordLLMPlannerCall(context: RunContext | { usageLedger?: UsageLedger }): void {
  ensureLedger(context).llmPlannerCalls += 1;
}

export function recordRuleReplannerAttempt(context: RunContext | { usageLedger?: UsageLedger }): void {
  ensureLedger(context).ruleReplannerAttempts += 1;
}

export function recordLLMReplannerCall(context: RunContext | { usageLedger?: UsageLedger }): void {
  ensureLedger(context).llmReplannerCalls += 1;
}

export function recordLLMDiagnoserCall(context: RunContext | { usageLedger?: UsageLedger }): void {
  ensureLedger(context).llmDiagnoserCalls += 1;
}

export function recordPlannerTimeout(context: RunContext | { usageLedger?: UsageLedger }): void {
  ensureLedger(context).plannerTimeouts += 1;
}

export function recordReplannerTimeout(context: RunContext | { usageLedger?: UsageLedger }): void {
  ensureLedger(context).replannerTimeouts += 1;
}

export function recordDiagnoserTimeout(context: RunContext | { usageLedger?: UsageLedger }): void {
  ensureLedger(context).diagnoserTimeouts += 1;
}

export function recordPlannerFallback(context: RunContext | { usageLedger?: UsageLedger }): void {
  ensureLedger(context).plannerFallbacks += 1;
}

export function recordReplannerFallback(context: RunContext | { usageLedger?: UsageLedger }): void {
  ensureLedger(context).replannerFallbacks += 1;
}

function ensureLedger(context: RunContext | { usageLedger?: UsageLedger }): UsageLedger {
  if (!context.usageLedger) {
    context.usageLedger = createUsageLedger();
  }

  return context.usageLedger;
}
