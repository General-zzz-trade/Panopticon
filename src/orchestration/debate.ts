/**
 * A-HMAD: Adaptive Heterogeneous Multi-Agent Debate framework.
 *
 * Multiple agents independently answer the same question, critique each
 * other's answers across one or more debate rounds, then vote on a final
 * answer weighted by agent reliability and self-reported confidence.
 */

import { runGoal } from "../core/runtime";
import { logModuleError } from "../core/module-logger";

export interface DebateRound {
  round: number;
  responses: AgentResponse[];
}

export interface AgentResponse {
  agentId: string;
  answer: string;
  confidence: number; // 0-1, extracted from agent's response
  critique?: string; // Commentary on other agents' answers (rounds > 0)
  reasoning?: string;
}

export interface DebateOptions {
  question: string;
  /** Number of agents to instantiate (default: 3) */
  numAgents?: number;
  /** Number of debate rounds (default: 2) */
  numRounds?: number;
  /** Weights per agent for final vote (default: all equal) */
  agentWeights?: number[];
}

export interface DebateResult {
  question: string;
  rounds: DebateRound[];
  finalAnswer: string;
  consensusScore: number; // 0-1, how much agents agreed
  votingMethod: "majority" | "weighted";
}

/**
 * Normalize an answer string for grouping: lowercase, collapse whitespace,
 * trim, and truncate to the first 100 characters.
 */
export function normalizeAnswer(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

/**
 * Parse an agent's raw response to extract the answer, confidence, and
 * optional reasoning. Falls back to using the whole text as the answer
 * with confidence 0.5 if no structured data is found.
 */
export function parseAgentResponse(
  raw: string
): { answer: string; confidence: number; reasoning?: string } {
  if (!raw || typeof raw !== "string") {
    return { answer: "", confidence: 0.5 };
  }

  const trimmed = raw.trim();

  // Try strict JSON first.
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") {
      const answer = typeof parsed.answer === "string" ? parsed.answer : "";
      const confidence =
        typeof parsed.confidence === "number" ? parsed.confidence : 0.5;
      const reasoning =
        typeof parsed.reasoning === "string" ? parsed.reasoning : undefined;
      if (answer) {
        return {
          answer,
          confidence: clampConfidence(confidence),
          reasoning,
        };
      }
    }
  } catch {
    // Not valid strict JSON — fall through to permissive extraction.
  }

  // Try to find a JSON-like object embedded in the text.
  const braceMatch = trimmed.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      const parsed = JSON.parse(braceMatch[0]);
      if (parsed && typeof parsed === "object") {
        const answer = typeof parsed.answer === "string" ? parsed.answer : "";
        const confidence =
          typeof parsed.confidence === "number" ? parsed.confidence : 0.5;
        const reasoning =
          typeof parsed.reasoning === "string" ? parsed.reasoning : undefined;
        if (answer) {
          return {
            answer,
            confidence: clampConfidence(confidence),
            reasoning,
          };
        }
      }
    } catch {
      // continue to regex-based extraction
    }
  }

  // Regex-based field extraction for loosely-structured responses.
  const answerMatch =
    trimmed.match(/["']?answer["']?\s*[:=]\s*["']([^"']+)["']/i) ||
    trimmed.match(/answer\s*[:=]\s*([^\n,}]+)/i);
  const confMatch =
    trimmed.match(/["']?confidence["']?\s*[:=]\s*([0-9]*\.?[0-9]+)/i);
  const reasonMatch =
    trimmed.match(/["']?reasoning["']?\s*[:=]\s*["']([^"']+)["']/i) ||
    trimmed.match(/reasoning\s*[:=]\s*([^\n}]+)/i);

  if (answerMatch) {
    const answer = answerMatch[1].trim().replace(/^["']|["']$/g, "");
    const confidence = confMatch
      ? clampConfidence(parseFloat(confMatch[1]))
      : 0.5;
    const reasoning = reasonMatch
      ? reasonMatch[1].trim().replace(/^["']|["']$/g, "")
      : undefined;
    return { answer, confidence, reasoning };
  }

  // Fallback: treat the whole response as the answer.
  return { answer: trimmed, confidence: 0.5 };
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Compute a weighted vote across agent responses. Groups responses with
 * similar normalized answers, sums weight * confidence per group, and
 * returns the highest-scoring answer. On ties, the earliest-seen answer
 * wins (stable ordering over the response array).
 */
export function computeWeightedVote(
  responses: AgentResponse[],
  weights: number[]
): { winner: string; score: number } {
  if (responses.length === 0) {
    return { winner: "", score: 0 };
  }

  // Map normalized key -> { displayAnswer, score, firstIndex }
  const groups = new Map<
    string,
    { displayAnswer: string; score: number; firstIndex: number }
  >();

  responses.forEach((response, index) => {
    const weight = weights[index] ?? 1;
    const key = normalizeAnswer(response.answer);
    const contribution = weight * response.confidence;
    const existing = groups.get(key);
    if (existing) {
      existing.score += contribution;
    } else {
      groups.set(key, {
        displayAnswer: response.answer,
        score: contribution,
        firstIndex: index,
      });
    }
  });

  let bestAnswer = "";
  let bestScore = -Infinity;
  let bestIndex = Infinity;
  for (const group of groups.values()) {
    if (
      group.score > bestScore ||
      (group.score === bestScore && group.firstIndex < bestIndex)
    ) {
      bestAnswer = group.displayAnswer;
      bestScore = group.score;
      bestIndex = group.firstIndex;
    }
  }

  return { winner: bestAnswer, score: bestScore === -Infinity ? 0 : bestScore };
}

/**
 * Run a multi-agent debate on a question and return the consensus answer.
 */
export async function runDebate(options: DebateOptions): Promise<DebateResult> {
  const numAgents = options.numAgents ?? 3;
  const numRounds = options.numRounds ?? 2;
  const weights =
    options.agentWeights && options.agentWeights.length === numAgents
      ? options.agentWeights
      : new Array(numAgents).fill(1);
  const hasCustomWeights = Boolean(
    options.agentWeights && options.agentWeights.length === numAgents
  );

  const agentIds = Array.from({ length: numAgents }, (_, i) => `agent-${i}`);
  const rounds: DebateRound[] = [];

  // --- Round 0: independent answers ---
  const initialPrompt = (agentId: string) =>
    `You are ${agentId}. Answer this question with your reasoning and a confidence score (0-1):\n` +
    `${options.question}\n` +
    `Respond strictly in JSON format: {"answer": "...", "reasoning": "...", "confidence": 0.X}`;

  const initialResults = await Promise.all(
    agentIds.map(async (agentId) => {
      try {
        const ctx = await runGoal(initialPrompt(agentId), {
          executionMode: "react",
        });
        const raw = extractAnswerFromContext(ctx);
        const parsed = parseAgentResponse(raw);
        const response: AgentResponse = {
          agentId,
          answer: parsed.answer,
          confidence: parsed.confidence,
          reasoning: parsed.reasoning,
        };
        return response;
      } catch (error) {
        logModuleError("debate", "optional", error, `agent ${agentId} round 0`);
        const response: AgentResponse = {
          agentId,
          answer: "",
          confidence: 0,
        };
        return response;
      }
    })
  );

  rounds.push({ round: 0, responses: initialResults });

  // --- Rounds 1..N: critique & refine ---
  for (let round = 1; round <= numRounds; round++) {
    const previous = rounds[round - 1].responses;
    const roundResults = await Promise.all(
      agentIds.map(async (agentId, index) => {
        const self = previous[index];
        const others = previous.filter((_, i) => i !== index);
        const otherAnswersText = others
          .map(
            (o) =>
              `- ${o.agentId} (confidence ${o.confidence.toFixed(2)}): ${o.answer}`
          )
          .join("\n");

        const prompt =
          `You are ${agentId}.\n` +
          `Question: ${options.question}\n` +
          `Your previous answer: ${self.answer}\n` +
          `Other agents said:\n${otherAnswersText}\n` +
          `Critique the other answers and provide your updated response with confidence.\n` +
          `Respond strictly in JSON format: {"answer": "...", "reasoning": "...", "critique": "...", "confidence": 0.X}`;

        try {
          const ctx = await runGoal(prompt, { executionMode: "react" });
          const raw = extractAnswerFromContext(ctx);
          const parsed = parseAgentResponse(raw);
          const critiqueMatch = raw.match(
            /["']?critique["']?\s*[:=]\s*["']([^"']+)["']/i
          );
          const response: AgentResponse = {
            agentId,
            answer: parsed.answer,
            confidence: parsed.confidence,
            reasoning: parsed.reasoning,
            critique: critiqueMatch ? critiqueMatch[1] : undefined,
          };
          return response;
        } catch (error) {
          logModuleError(
            "debate",
            "optional",
            error,
            `agent ${agentId} round ${round}`
          );
          // Preserve prior answer on failure.
          const response: AgentResponse = {
            agentId,
            answer: self.answer,
            confidence: self.confidence * 0.5,
            reasoning: self.reasoning,
          };
          return response;
        }
      })
    );

    rounds.push({ round, responses: roundResults });
  }

  // --- Final vote using the last round ---
  const finalResponses = rounds[rounds.length - 1].responses;
  const { winner } = computeWeightedVote(finalResponses, weights);

  // Consensus: fraction of agents whose normalized answer matches the winner.
  const winnerKey = normalizeAnswer(winner);
  const agreeing = finalResponses.filter(
    (r) => normalizeAnswer(r.answer) === winnerKey
  ).length;
  const consensusScore =
    finalResponses.length > 0 ? agreeing / finalResponses.length : 0;

  return {
    question: options.question,
    rounds,
    finalAnswer: winner,
    consensusScore,
    votingMethod: hasCustomWeights ? "weighted" : "majority",
  };
}

/**
 * Best-effort extraction of an agent's textual answer from a RunContext.
 * The ReAct runtime surfaces a result message; artifacts may also contain
 * response text. We return whichever is present.
 */
function extractAnswerFromContext(ctx: unknown): string {
  if (!ctx || typeof ctx !== "object") return "";
  const c = ctx as {
    result?: { message?: string };
    artifacts?: Array<{ content?: unknown; data?: unknown }>;
  };
  if (c.result?.message) return c.result.message;
  if (Array.isArray(c.artifacts) && c.artifacts.length > 0) {
    const last = c.artifacts[c.artifacts.length - 1];
    const content = last?.content ?? last?.data;
    if (typeof content === "string") return content;
    if (content != null) {
      try {
        return JSON.stringify(content);
      } catch {
        return String(content);
      }
    }
  }
  return "";
}
