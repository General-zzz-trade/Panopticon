import { randomUUID } from "node:crypto";
import { publishEvent } from "../streaming/event-bus";

export type DialogueType = "approval" | "clarification" | "choice";

export interface ApprovalRequest {
  id: string;
  runId: string;
  taskId: string;
  taskType: string;
  taskPayload: Record<string, unknown>;
  reason: string;
  status: "pending" | "approved" | "rejected";
  requestedAt: string;
  respondedAt?: string;
  respondedBy?: string;
  /** Type of dialogue: approval (yes/no), clarification (free text), choice (pick from options) */
  dialogueType?: DialogueType;
  /** Question to ask the user (for clarification/choice) */
  question?: string;
  /** Options for choice-type dialogue */
  options?: string[];
  /** User's answer (for clarification/choice) */
  answer?: string;
  /** Selected option index (for choice) */
  selectedOption?: number;
}

export interface ApprovalPolicy {
  enabled: boolean;
  requireApproval: string[];
  autoApproveTimeout?: number;
}

export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = {
  enabled: false,
  requireApproval: ["run_code", "write_file"],
  autoApproveTimeout: 0
};

interface PendingEntry {
  request: ApprovalRequest;
  resolve: (approved: boolean) => void;
  timer?: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingEntry>();

export function requiresApproval(
  taskType: string,
  _payload: Record<string, unknown>,
  policy: ApprovalPolicy
): boolean {
  return policy.enabled && policy.requireApproval.includes(taskType);
}

export async function requestApproval(
  input: Omit<ApprovalRequest, "id" | "status" | "requestedAt">
): Promise<ApprovalRequest> {
  const id = randomUUID();
  const request: ApprovalRequest = {
    ...input,
    id,
    status: "pending",
    requestedAt: new Date().toISOString()
  };

  const approved = await new Promise<boolean>((resolve) => {
    const entry: PendingEntry = { request, resolve };

    // Auto-approve timeout (0 = wait forever)
    const timeout = (input as Record<string, unknown>)._autoApproveTimeout as number | undefined;
    if (timeout && timeout > 0) {
      entry.timer = setTimeout(() => {
        resolve(true);
      }, timeout);
    }

    pending.set(id, entry);

    // Publish SSE event so the UI picks it up
    publishEvent({
      type: "approval_required",
      runId: input.runId,
      taskId: input.taskId,
      taskType: input.taskType,
      timestamp: request.requestedAt,
      payload: {
        approvalId: id,
        taskPayload: input.taskPayload,
        reason: input.reason
      }
    });
  });

  request.status = approved ? "approved" : "rejected";
  request.respondedAt = new Date().toISOString();
  pending.delete(id);

  return request;
}

export function respondToApproval(
  id: string,
  approved: boolean,
  respondedBy?: string,
  answer?: string,
  selectedOption?: number
): ApprovalRequest | undefined {
  const entry = pending.get(id);
  if (!entry) return undefined;

  if (entry.timer) clearTimeout(entry.timer);

  entry.request.respondedBy = respondedBy;
  if (answer !== undefined) entry.request.answer = answer;
  if (selectedOption !== undefined) entry.request.selectedOption = selectedOption;
  entry.resolve(approved);

  return {
    ...entry.request,
    status: approved ? "approved" : "rejected",
    respondedAt: new Date().toISOString(),
    respondedBy
  };
}

export function getPendingApprovals(runId: string): ApprovalRequest[] {
  const results: ApprovalRequest[] = [];
  for (const entry of pending.values()) {
    if (entry.request.runId === runId && entry.request.status === "pending") {
      results.push({ ...entry.request });
    }
  }
  return results;
}

/**
 * Request a mid-run dialogue with the user.
 * Returns the approval request with the user's answer.
 */
export async function requestDialogue(input: {
  runId: string;
  taskId: string;
  taskType: string;
  dialogueType: DialogueType;
  question: string;
  options?: string[];
  reason: string;
}): Promise<ApprovalRequest> {
  const result = await requestApproval({
    runId: input.runId,
    taskId: input.taskId,
    taskType: input.taskType,
    taskPayload: {
      dialogueType: input.dialogueType,
      question: input.question,
      options: input.options
    },
    reason: input.reason
  });
  // Copy dialogue fields onto the result
  result.dialogueType = input.dialogueType;
  result.question = input.question;
  result.options = input.options;
  return result;
}

/**
 * Get the answer from a dialogue response.
 * Returns the answer string, selected option text, or undefined.
 */
export function getDialogueAnswer(request: ApprovalRequest): string | undefined {
  if (request.answer) return request.answer;
  if (request.selectedOption !== undefined && request.options) {
    return request.options[request.selectedOption];
  }
  return undefined;
}

export function clearApprovals(runId: string): void {
  for (const [id, entry] of pending.entries()) {
    if (entry.request.runId === runId) {
      if (entry.timer) clearTimeout(entry.timer);
      // Reject any still-pending approvals so they don't hang forever
      entry.resolve(false);
      pending.delete(id);
    }
  }
}
