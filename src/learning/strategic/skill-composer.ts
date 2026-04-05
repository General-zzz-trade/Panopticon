/**
 * Skill Composer — maintains a library of reusable skills
 * (task-type sequences) and composes them into novel plans
 * by chaining postconditions to preconditions.
 */

export interface Skill {
  name: string;
  description: string;
  steps: string[];
  preconditions: string[];
  postconditions: string[];
  successRate: number;
  domain?: string;
}

export interface ComposedPlan {
  skills: Skill[];
  totalSteps: number;
  estimatedSuccessRate: number;
  rationale: string;
}

/** In-memory skill library. */
const skillLibrary: Skill[] = [];

// Register built-in skills on module load
function initBuiltins(): void {
  const builtins: Skill[] = [
    {
      name: "login",
      description: "Log in to a website with username and password",
      steps: ["open_page", "type", "type", "click"],
      preconditions: ["page_loaded"],
      postconditions: ["logged_in"],
      successRate: 0.85,
    },
    {
      name: "search",
      description: "Search for content using a search form",
      steps: ["type", "click", "assert_text"],
      preconditions: ["page_loaded"],
      postconditions: ["search_results_visible"],
      successRate: 0.9,
    },
    {
      name: "navigate",
      description: "Navigate to a page and verify it loaded",
      steps: ["open_page", "assert_text"],
      preconditions: [],
      postconditions: ["page_loaded"],
      successRate: 0.95,
    },
    {
      name: "fill_form",
      description: "Fill out and submit a form",
      steps: ["type", "click"],
      preconditions: ["page_loaded"],
      postconditions: ["form_submitted"],
      successRate: 0.8,
    },
  ];

  for (const skill of builtins) {
    if (!skillLibrary.some((s) => s.name === skill.name)) {
      skillLibrary.push(skill);
    }
  }
}

initBuiltins();

/**
 * Register a new skill in the library.
 * If a skill with the same name exists, it is replaced.
 */
export function registerSkill(skill: Skill): void {
  const idx = skillLibrary.findIndex((s) => s.name === skill.name);
  if (idx >= 0) {
    skillLibrary[idx] = skill;
  } else {
    skillLibrary.push(skill);
  }
}

/**
 * Find skills relevant to a goal by matching keywords against
 * skill names and descriptions.
 */
export function findSkillsForGoal(goalIntent: string): Skill[] {
  const lower = goalIntent.toLowerCase();
  const words = lower.split(/\s+/).filter((w) => w.length > 2);

  return skillLibrary.filter((skill) => {
    const haystack =
      `${skill.name} ${skill.description} ${skill.domain ?? ""}`.toLowerCase();
    return words.some((word) => haystack.includes(word));
  });
}

/**
 * Compose a sequence of skills that chains from a starting state
 * to a target state. Uses a BFS approach to find a valid chain
 * where each skill's preconditions are satisfied by the accumulated
 * postconditions of prior skills (or the starting state).
 *
 * @param from  Starting state (comma-separated conditions or single condition)
 * @param to    Target state (comma-separated conditions or single condition)
 * @param available  Skills to consider (subset of library)
 * @returns A composed plan, or undefined if no valid chain exists
 */
export function composeSkills(
  from: string,
  to: string,
  available: Skill[]
): ComposedPlan | undefined {
  const startConditions = new Set(
    from.split(",").map((s) => s.trim()).filter(Boolean)
  );
  const targetConditions = to.split(",").map((s) => s.trim()).filter(Boolean);

  if (targetConditions.length === 0) {
    return undefined;
  }

  interface SearchState {
    conditions: Set<string>;
    chain: Skill[];
  }

  const queue: SearchState[] = [
    { conditions: new Set(startConditions), chain: [] },
  ];
  const visited = new Set<string>();
  visited.add(serializeConditions(startConditions));

  // BFS with depth limit to avoid runaway searches
  const maxDepth = 10;

  while (queue.length > 0) {
    const current = queue.shift()!;

    // Check if target is satisfied
    if (targetConditions.every((tc) => current.conditions.has(tc))) {
      if (current.chain.length === 0) {
        return undefined; // Already satisfied, no skills needed
      }
      const totalSteps = current.chain.reduce(
        (sum, sk) => sum + sk.steps.length,
        0
      );
      const estimatedSuccessRate = current.chain.reduce(
        (rate, sk) => rate * sk.successRate,
        1
      );
      return {
        skills: current.chain,
        totalSteps,
        estimatedSuccessRate,
        rationale: `Chain: ${current.chain.map((s) => s.name).join(" -> ")}`,
      };
    }

    if (current.chain.length >= maxDepth) {
      continue;
    }

    for (const skill of available) {
      // Check if preconditions are met
      const presMet =
        skill.preconditions.length === 0 ||
        skill.preconditions.every((p) => current.conditions.has(p));
      if (!presMet) continue;

      // Avoid using the same skill twice in a chain
      if (current.chain.some((s) => s.name === skill.name)) continue;

      const nextConditions = new Set(current.conditions);
      for (const pc of skill.postconditions) {
        nextConditions.add(pc);
      }

      const key = serializeConditions(nextConditions);
      if (visited.has(key)) continue;
      visited.add(key);

      queue.push({
        conditions: nextConditions,
        chain: [...current.chain, skill],
      });
    }
  }

  return undefined;
}

/**
 * Get all registered skills (including built-ins).
 */
export function getAllSkills(): Skill[] {
  return [...skillLibrary];
}

/**
 * Clear the skill library and re-initialize built-ins (useful for testing).
 */
export function resetSkillLibrary(): void {
  skillLibrary.length = 0;
  initBuiltins();
}

function serializeConditions(conditions: Set<string>): string {
  return [...conditions].sort().join("|");
}
