/**
 * Knowledge Base Types
 *
 * Three categories of knowledge extracted from run history:
 * - selector_map:    URL domain + element description → CSS selector that worked
 * - failure_lesson:  task type + error pattern → recovery strategy
 * - task_template:   goal pattern → proven task sequence
 */

export type KnowledgeType = "selector_map" | "failure_lesson" | "task_template";

export interface SelectorMapEntry {
  domain: string;          // e.g. "localhost:3210"
  description: string;     // e.g. "login button"
  selector: string;        // e.g. "#login-button"
  pageUrl?: string;        // specific page if needed
  successCount: number;
  failureCount: number;
}

export interface FailureLessonEntry {
  taskType: string;              // e.g. "click"
  errorPattern: string;          // substring of error message
  domain?: string;
  recovery: string;              // what worked: "use visual_click" | "add wait 1000" | etc.
  successCount: number;
}

export interface TaskTemplateEntry {
  goalPattern: string;           // regex or keyword pattern
  domain?: string;
  tasksSummary: string;          // human-readable summary
  tasksJson: string;             // JSON array of TaskBlueprint
  successCount: number;
}

export interface KnowledgeEntry {
  id: number;
  type: KnowledgeType;
  domain: string;
  key: string;              // unique within (type, domain)
  valueJson: string;        // JSON-serialized payload
  confidence: number;       // 0.0 - 1.0
  useCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RelevantKnowledge {
  selectors: SelectorMapEntry[];
  lessons: FailureLessonEntry[];
  templates: TaskTemplateEntry[];
}
