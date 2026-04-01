import { AgentAction, AgentTask } from "../types";
import { TaskBlueprint, createTaskFromBlueprint } from "./task-id";

const ALLOWED_PAYLOAD_FIELDS: Record<AgentAction, string[]> = {
  start_app: ["command"],
  wait_for_server: ["url", "timeoutMs"],
  open_page: ["url"],
  click: ["selector"],
  type: ["selector", "text"],
  select: ["selector", "value"],
  scroll: ["selector", "direction", "amount"],
  hover: ["selector"],
  wait: ["durationMs"],
  assert_text: ["text", "timeoutMs"],
  screenshot: ["outputPath"],
  stop_app: [],
  visual_click: ["description"],
  visual_type: ["description", "text"],
  visual_assert: ["assertion"],
  visual_extract: ["description"]
};

const REQUIRED_PAYLOAD_FIELDS: Partial<Record<AgentAction, string[]>> = {
  start_app: ["command"],
  wait_for_server: ["url"],
  open_page: ["url"],
  click: ["selector"],
  type: ["selector", "text"],
  select: ["selector", "value"],
  hover: ["selector"],
  wait: ["durationMs"],
  assert_text: ["text"],
  visual_click: ["description"],
  visual_type: ["description", "text"],
  visual_assert: ["assertion"],
  visual_extract: ["description"]
};

export function validateAndMaterializeTasks(
  runId: string,
  blueprints: TaskBlueprint[]
): AgentTask[] | null {
  const tasks = blueprints.map((blueprint, index) => createTaskFromBlueprint(runId, index + 1, blueprint));

  if (!validateTasks(tasks)) {
    return null;
  }

  return tasks;
}

export function validateTasks(tasks: AgentTask[]): boolean {
  return validateTaskShape(tasks).valid;
}

export function validateTaskShape(tasks: AgentTask[]): { valid: boolean; issues: string[] } {
  const ids = new Set<string>();
  const issues: string[] = [];

  for (const task of tasks) {
    if (!ALLOWED_PAYLOAD_FIELDS[task.type]) {
      issues.push(`Unsupported task type: ${task.type}`);
      continue;
    }

    if (ids.has(task.id)) {
      issues.push(`Duplicate task id: ${task.id}`);
    }
    ids.add(task.id);

    const allowedFields = new Set(ALLOWED_PAYLOAD_FIELDS[task.type]);
    for (const key of Object.keys(task.payload)) {
      if (!allowedFields.has(key)) {
        issues.push(`${task.type} contains invalid payload field: ${key}`);
      }
    }

    const requiredFields = REQUIRED_PAYLOAD_FIELDS[task.type] ?? [];
    for (const field of requiredFields) {
      if (task.payload[field] === undefined || task.payload[field] === "") {
        issues.push(`${task.type} is missing required payload field: ${field}`);
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues
  };
}

export function validateTaskSemantics(tasks: AgentTask[]): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const has = (type: AgentTask["type"]): boolean => tasks.some((task) => task.type === type);
  const indexOf = (type: AgentTask["type"]): number => tasks.findIndex((task) => task.type === type);

  if (has("start_app") && !has("wait_for_server")) {
    issues.push("Semantic validation: start_app should be followed by wait_for_server.");
  }

  if (has("start_app") && !has("stop_app")) {
    issues.push("Semantic validation: start_app should be paired with stop_app.");
  }

  const INTERACTION_TYPES: AgentTask["type"][] = ["click", "type", "select", "hover", "scroll"];
  const hasInteraction = INTERACTION_TYPES.some((t) => has(t));

  for (const interactionType of INTERACTION_TYPES) {
    if (has(interactionType) && !has("open_page")) {
      issues.push(`Semantic validation: ${interactionType} requires open_page first.`);
      break;
    }
  }

  if (has("assert_text") && !has("open_page")) {
    issues.push("Semantic validation: assert_text requires open_page first.");
  }

  if (has("assert_text") && !hasInteraction && /dashboard|success|result|logged in/i.test(JSON.stringify(tasks.map((task) => task.payload)))) {
    issues.push("Semantic validation: assert_text looks stateful but no prior UI interaction exists.");
  }

  if (indexOf("wait_for_server") >= 0 && indexOf("start_app") >= 0 && indexOf("wait_for_server") < indexOf("start_app")) {
    issues.push("Semantic validation: wait_for_server appears before start_app.");
  }

  if (indexOf("open_page") >= 0 && indexOf("wait_for_server") >= 0 && indexOf("open_page") < indexOf("wait_for_server")) {
    issues.push("Semantic validation: open_page appears before wait_for_server.");
  }

  if (indexOf("click") >= 0 && indexOf("open_page") >= 0 && indexOf("click") < indexOf("open_page")) {
    issues.push("Semantic validation: click appears before open_page.");
  }

  if (indexOf("assert_text") >= 0 && indexOf("open_page") >= 0 && indexOf("assert_text") < indexOf("open_page")) {
    issues.push("Semantic validation: assert_text appears before open_page.");
  }

  if (indexOf("stop_app") >= 0 && indexOf("start_app") >= 0 && indexOf("stop_app") < indexOf("start_app")) {
    issues.push("Semantic validation: stop_app appears before start_app.");
  }

  return {
    valid: issues.length === 0,
    issues
  };
}
