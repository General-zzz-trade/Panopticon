/**
 * Workflow Engine — define and execute structured workflows with
 * sequential tasks, conditions, loops, parallel branches, and waits.
 *
 * Workflows are stored in-memory and executed step-by-step with
 * variable interpolation and branching logic.
 */

import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkflowStep {
  id: string;
  type: "task" | "condition" | "loop" | "parallel" | "wait";
  task?: { type: string; payload: Record<string, unknown> };
  condition?: { expression: string; thenSteps: string[]; elseSteps: string[] };
  loop?: { times: number; steps: string[] };
  parallel?: { steps: string[][] };
  next?: string;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  variables: Record<string, unknown>;
}

export type WorkflowRunStatus = "pending" | "running" | "completed" | "failed";

export interface StepResult {
  stepId: string;
  status: "completed" | "skipped" | "failed";
  output?: unknown;
  durationMs: number;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  status: WorkflowRunStatus;
  variables: Record<string, unknown>;
  stepResults: StepResult[];
  startedAt: string;
  completedAt: string | null;
  error?: string;
}

// ---------------------------------------------------------------------------
// Storage (in-memory)
// ---------------------------------------------------------------------------

const workflows = new Map<string, Workflow>();
const runs = new Map<string, WorkflowRun>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate and store a workflow definition.
 */
export function createWorkflow(def: Omit<Workflow, "id"> & { id?: string }): Workflow {
  const workflow: Workflow = {
    id: def.id ?? `wf-${randomUUID()}`,
    name: def.name,
    description: def.description,
    steps: def.steps,
    variables: def.variables ?? {},
  };

  validateWorkflow(workflow);
  workflows.set(workflow.id, workflow);
  return workflow;
}

/**
 * Get a workflow by id.
 */
export function getWorkflow(id: string): Workflow | undefined {
  return workflows.get(id);
}

/**
 * List all workflows.
 */
export function listWorkflows(): Workflow[] {
  return Array.from(workflows.values());
}

/**
 * Delete a workflow by id.
 */
export function deleteWorkflow(id: string): boolean {
  return workflows.delete(id);
}

/**
 * Execute a workflow. Returns a run record with step results.
 */
export async function runWorkflow(
  workflowId: string,
  variables?: Record<string, unknown>
): Promise<WorkflowRun> {
  const workflow = workflows.get(workflowId);
  if (!workflow) {
    throw new Error(`Workflow not found: ${workflowId}`);
  }

  const run: WorkflowRun = {
    id: `wfrun-${randomUUID()}`,
    workflowId,
    status: "running",
    variables: { ...workflow.variables, ...variables },
    stepResults: [],
    startedAt: new Date().toISOString(),
    completedAt: null,
  };
  runs.set(run.id, run);

  try {
    // Build step map for random access
    const stepMap = new Map<string, WorkflowStep>();
    for (const step of workflow.steps) {
      stepMap.set(step.id, step);
    }

    // Start from first step, follow 'next' pointers
    let currentStepId: string | undefined = workflow.steps[0]?.id;

    while (currentStepId) {
      const step = stepMap.get(currentStepId);
      if (!step) break;

      const result = await executeStep(step, run, stepMap);
      run.stepResults.push(result);

      if (result.status === "failed") {
        run.status = "failed";
        run.error = `Step ${step.id} failed`;
        run.completedAt = new Date().toISOString();
        return run;
      }

      currentStepId = step.next;
    }

    run.status = "completed";
    run.completedAt = new Date().toISOString();
  } catch (err) {
    run.status = "failed";
    run.error = err instanceof Error ? err.message : String(err);
    run.completedAt = new Date().toISOString();
  }

  return run;
}

/**
 * Get a workflow run by id.
 */
export function getWorkflowRun(runId: string): WorkflowRun | undefined {
  return runs.get(runId);
}

// ---------------------------------------------------------------------------
// Step execution
// ---------------------------------------------------------------------------

async function executeStep(
  step: WorkflowStep,
  run: WorkflowRun,
  stepMap: Map<string, WorkflowStep>
): Promise<StepResult> {
  const start = Date.now();

  switch (step.type) {
    case "task":
      return executeTaskStep(step, run, start);

    case "condition":
      return executeConditionStep(step, run, stepMap, start);

    case "loop":
      return executeLoopStep(step, run, stepMap, start);

    case "parallel":
      return executeParallelStep(step, run, stepMap, start);

    case "wait":
      return executeWaitStep(step, start);

    default:
      return {
        stepId: step.id,
        status: "failed",
        output: `Unknown step type: ${step.type}`,
        durationMs: Date.now() - start,
      };
  }
}

async function executeTaskStep(
  step: WorkflowStep,
  run: WorkflowRun,
  start: number
): Promise<StepResult> {
  const task = step.task;
  if (!task) {
    return { stepId: step.id, status: "failed", output: "No task definition", durationMs: Date.now() - start };
  }

  // Interpolate variables into payload
  const payload = interpolatePayload(task.payload, run.variables);

  // Store result in variables for downstream steps
  run.variables[`result_${step.id}`] = { type: task.type, payload };

  return {
    stepId: step.id,
    status: "completed",
    output: { type: task.type, payload },
    durationMs: Date.now() - start,
  };
}

async function executeConditionStep(
  step: WorkflowStep,
  run: WorkflowRun,
  stepMap: Map<string, WorkflowStep>,
  start: number
): Promise<StepResult> {
  const cond = step.condition;
  if (!cond) {
    return { stepId: step.id, status: "failed", output: "No condition definition", durationMs: Date.now() - start };
  }

  const branchTaken = evaluateExpression(cond.expression, run.variables);
  const branchSteps = branchTaken ? cond.thenSteps : cond.elseSteps;

  for (const subStepId of branchSteps) {
    const subStep = stepMap.get(subStepId);
    if (!subStep) continue;
    const subResult = await executeStep(subStep, run, stepMap);
    run.stepResults.push(subResult);
    if (subResult.status === "failed") {
      return { stepId: step.id, status: "failed", output: `Sub-step ${subStepId} failed`, durationMs: Date.now() - start };
    }
  }

  return {
    stepId: step.id,
    status: "completed",
    output: { branch: branchTaken ? "then" : "else", stepsRun: branchSteps },
    durationMs: Date.now() - start,
  };
}

async function executeLoopStep(
  step: WorkflowStep,
  run: WorkflowRun,
  stepMap: Map<string, WorkflowStep>,
  start: number
): Promise<StepResult> {
  const loop = step.loop;
  if (!loop) {
    return { stepId: step.id, status: "failed", output: "No loop definition", durationMs: Date.now() - start };
  }

  for (let iteration = 0; iteration < loop.times; iteration++) {
    run.variables["loop_index"] = iteration;

    for (const subStepId of loop.steps) {
      const subStep = stepMap.get(subStepId);
      if (!subStep) continue;
      const subResult = await executeStep(subStep, run, stepMap);
      run.stepResults.push(subResult);
      if (subResult.status === "failed") {
        return { stepId: step.id, status: "failed", output: `Loop iteration ${iteration}, step ${subStepId} failed`, durationMs: Date.now() - start };
      }
    }
  }

  return {
    stepId: step.id,
    status: "completed",
    output: { iterations: loop.times },
    durationMs: Date.now() - start,
  };
}

async function executeParallelStep(
  step: WorkflowStep,
  run: WorkflowRun,
  stepMap: Map<string, WorkflowStep>,
  start: number
): Promise<StepResult> {
  const parallel = step.parallel;
  if (!parallel) {
    return { stepId: step.id, status: "failed", output: "No parallel definition", durationMs: Date.now() - start };
  }

  // Each entry in parallel.steps is a sequence of step IDs to run as one branch
  const branchPromises = parallel.steps.map(async (branch) => {
    for (const subStepId of branch) {
      const subStep = stepMap.get(subStepId);
      if (!subStep) continue;
      const subResult = await executeStep(subStep, run, stepMap);
      run.stepResults.push(subResult);
      if (subResult.status === "failed") {
        throw new Error(`Parallel branch step ${subStepId} failed`);
      }
    }
  });

  try {
    await Promise.all(branchPromises);
  } catch {
    return { stepId: step.id, status: "failed", output: "Parallel branch failed", durationMs: Date.now() - start };
  }

  return {
    stepId: step.id,
    status: "completed",
    output: { branches: parallel.steps.length },
    durationMs: Date.now() - start,
  };
}

async function executeWaitStep(
  step: WorkflowStep,
  start: number
): Promise<StepResult> {
  // Wait steps are no-ops in the engine; callers can use them as sync points
  return {
    stepId: step.id,
    status: "completed",
    output: "wait_complete",
    durationMs: Date.now() - start,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateWorkflow(workflow: Workflow): void {
  if (!workflow.name) throw new Error("Workflow name is required");
  if (!workflow.steps || workflow.steps.length === 0) {
    throw new Error("Workflow must have at least one step");
  }

  const ids = new Set<string>();
  for (const step of workflow.steps) {
    if (!step.id) throw new Error("Every step must have an id");
    if (ids.has(step.id)) throw new Error(`Duplicate step id: ${step.id}`);
    ids.add(step.id);

    const validTypes = ["task", "condition", "loop", "parallel", "wait"];
    if (!validTypes.includes(step.type)) {
      throw new Error(`Invalid step type: ${step.type}`);
    }
  }
}

function evaluateExpression(expression: string, variables: Record<string, unknown>): boolean {
  // Simple expression evaluator: supports "variable == value", "variable != value",
  // "variable > value", truthy checks
  const trimmed = expression.trim();

  // Equality: "status == done"
  const eqMatch = trimmed.match(/^(\w+)\s*==\s*(.+)$/);
  if (eqMatch) {
    const varVal = variables[eqMatch[1]];
    const compare = eqMatch[2].trim().replace(/^["']|["']$/g, "");
    return String(varVal) === compare;
  }

  // Inequality: "count != 0"
  const neqMatch = trimmed.match(/^(\w+)\s*!=\s*(.+)$/);
  if (neqMatch) {
    const varVal = variables[neqMatch[1]];
    const compare = neqMatch[2].trim().replace(/^["']|["']$/g, "");
    return String(varVal) !== compare;
  }

  // Greater than: "count > 5"
  const gtMatch = trimmed.match(/^(\w+)\s*>\s*(.+)$/);
  if (gtMatch) {
    return Number(variables[gtMatch[1]]) > Number(gtMatch[2]);
  }

  // Less than: "count < 5"
  const ltMatch = trimmed.match(/^(\w+)\s*<\s*(.+)$/);
  if (ltMatch) {
    return Number(variables[ltMatch[1]]) < Number(ltMatch[2]);
  }

  // Truthy: just a variable name
  return !!variables[trimmed];
}

function interpolatePayload(
  payload: Record<string, unknown>,
  variables: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === "string") {
      // Replace {{varName}} with variable values
      result[key] = value.replace(/\{\{(\w+)\}\}/g, (_, varName) => {
        const val = variables[varName];
        return val !== undefined ? String(val) : `{{${varName}}}`;
      });
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      result[key] = interpolatePayload(value as Record<string, unknown>, variables);
    } else {
      result[key] = value;
    }
  }

  return result;
}
