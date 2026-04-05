/**
 * Page Model — extracts semantic page structure from observation data.
 * Builds a structured understanding of the current page, not raw DOM.
 */

import type {
  AgentObservation,
  ActionableElementObservation,
  WorldStateSnapshot,
} from "../cognition/types";

// ── Types ───────────────────────────────────────────────────────────────────

export type PageType =
  | "login"
  | "form"
  | "dashboard"
  | "listing"
  | "detail"
  | "search"
  | "error"
  | "loading"
  | "unknown";

export interface PageElement {
  role:
    | "navigation"
    | "form"
    | "button"
    | "input"
    | "link"
    | "heading"
    | "content"
    | "error_message";
  text: string;
  selector?: string;
  interactable: boolean;
}

export interface FormModel {
  action?: string;
  fields: Array<{
    name: string;
    type: string;
    required: boolean;
    label?: string;
  }>;
  submitButton?: PageElement;
}

export interface NavigationModel {
  links: Array<{ text: string; href?: string; selector?: string }>;
  breadcrumbs: string[];
  currentSection?: string;
}

export interface PageModel {
  pageType: PageType;
  title: string;
  url: string;
  elements: PageElement[];
  forms: FormModel[];
  navigation: NavigationModel;
  /** Key content areas detected */
  contentAreas: string[];
}

// ── Classification Rules ────────────────────────────────────────────────────

const LOGIN_TEXT = /\b(sign\s*in|log\s*in|password|username|credentials)\b/i;
const LOGIN_URL = /\/(login|signin|auth|sso)\b/i;

const DASHBOARD_TEXT = /\b(dashboard|overview|summary|analytics|metrics)\b/i;
const DASHBOARD_URL = /\/(dashboard|admin|overview)\b/i;

const SEARCH_TEXT = /\b(search\s+results|showing\s+\d+|results?\s+for)\b/i;

const ERROR_TEXT = /\b(404|500|error|not\s+found|forbidden|access\s+denied|something\s+went\s+wrong)\b/i;

const LOADING_TEXT = /\b(loading|please\s+wait|spinner|fetching)\b/i;

// ── Page Type Classification ────────────────────────────────────────────────

export function classifyPageType(observation: AgentObservation): PageType {
  const text = (observation.visibleText ?? []).join(" ");
  const url = observation.pageUrl ?? "";
  const elements = observation.actionableElements ?? [];

  // Login: text or URL signals
  if (LOGIN_TEXT.test(text) || LOGIN_URL.test(url)) {
    return "login";
  }

  // Error pages
  if (ERROR_TEXT.test(text)) {
    return "error";
  }

  // Loading state
  if (LOADING_TEXT.test(text)) {
    return "loading";
  }

  // Dashboard
  if (DASHBOARD_TEXT.test(text) || DASHBOARD_URL.test(url)) {
    return "dashboard";
  }

  // Search results
  if (SEARCH_TEXT.test(text) || hasSearchInput(elements)) {
    return "search";
  }

  // Form: multiple inputs + submit button
  const inputCount = elements.filter(
    (e) => e.role === "textbox" || e.role === "input" || e.role === "combobox"
  ).length;
  const hasSubmit = elements.some(
    (e) =>
      e.role === "button" &&
      /\b(submit|save|send|create|update|confirm)\b/i.test(e.text ?? "")
  );
  if (inputCount >= 2 && hasSubmit) {
    return "form";
  }

  // Listing: many similar link elements, pagination signals
  const linkCount = elements.filter(
    (e) => e.role === "link" || e.role === "listitem"
  ).length;
  const hasPagination = /\b(next|previous|page\s+\d+|showing\s+\d+\s*[-–]\s*\d+)\b/i.test(text);
  if (linkCount >= 5 && hasPagination) {
    return "listing";
  }

  // Detail: single entity with headings but no listing signals
  if (linkCount < 5 && elements.length > 0 && inputCount === 0) {
    return "detail";
  }

  return "unknown";
}

function hasSearchInput(elements: ActionableElementObservation[]): boolean {
  return elements.some(
    (e) =>
      (e.role === "searchbox" || e.role === "textbox") &&
      /search/i.test(e.text ?? e.selector ?? "")
  );
}

// ── Form Extraction ─────────────────────────────────────────────────────────

export function findForms(
  elements: ActionableElementObservation[]
): FormModel[] {
  const inputs = elements.filter(
    (e) =>
      e.role === "textbox" ||
      e.role === "input" ||
      e.role === "combobox" ||
      e.role === "spinbutton" ||
      e.role === "searchbox"
  );
  const buttons = elements.filter((e) => e.role === "button");

  if (inputs.length === 0) return [];

  // Group inputs into forms heuristically:
  // For now, treat all inputs as belonging to one form.
  const fields = inputs.map((inp) => {
    const name = inp.text ?? inp.selector ?? "unnamed";
    const type = inferInputType(inp);
    const required = /required|\*/i.test(inp.text ?? "");
    const label = inp.text || undefined;
    return { name, type, required, label };
  });

  const submitButton = buttons.find((b) =>
    /\b(submit|save|send|create|update|confirm|sign|log)\b/i.test(b.text ?? "")
  );

  const form: FormModel = {
    fields,
    submitButton: submitButton
      ? {
          role: "button",
          text: submitButton.text ?? "Submit",
          selector: submitButton.selector,
          interactable: true,
        }
      : undefined,
  };

  return [form];
}

function inferInputType(element: ActionableElementObservation): string {
  const text = (element.text ?? "").toLowerCase();
  const selector = (element.selector ?? "").toLowerCase();
  const combined = `${text} ${selector}`;

  if (/password/i.test(combined)) return "password";
  if (/email/i.test(combined)) return "email";
  if (/search/i.test(combined)) return "search";
  if (/phone|tel/i.test(combined)) return "tel";
  if (/number|amount|quantity/i.test(combined)) return "number";
  if (/date/i.test(combined)) return "date";
  if (/url|website/i.test(combined)) return "url";
  if (element.role === "combobox") return "select";
  return "text";
}

// ── Navigation Extraction ───────────────────────────────────────────────────

export function findNavigation(
  elements: ActionableElementObservation[]
): NavigationModel {
  const links = elements
    .filter((e) => e.role === "link" || e.role === "menuitem")
    .map((e) => ({
      text: e.text ?? "",
      href: undefined as string | undefined,
      selector: e.selector,
    }));

  // Detect breadcrumbs: look for elements with ">" or "/" separators in text
  const breadcrumbs: string[] = [];
  for (const el of elements) {
    const t = el.text ?? "";
    if (/\s*[>›»\/]\s*/.test(t) && t.split(/[>›»\/]/).length >= 2) {
      breadcrumbs.push(
        ...t
          .split(/[>›»\/]/)
          .map((s) => s.trim())
          .filter(Boolean)
      );
      break; // only first breadcrumb-like element
    }
  }

  // Detect current section from active/highlighted nav items
  const currentSection = elements.find(
    (e) =>
      (e.role === "link" || e.role === "menuitem") &&
      /active|current|selected/i.test(e.selector ?? "")
  )?.text;

  return { links, breadcrumbs, currentSection };
}

// ── Full Page Model ─────────────────────────────────────────────────────────

export function extractPageModel(
  observation: AgentObservation,
  worldState?: WorldStateSnapshot
): PageModel {
  const elements = observation.actionableElements ?? [];
  const pageType = classifyPageType(observation);

  // Convert actionable elements to PageElements
  const pageElements: PageElement[] = elements.map((el) =>
    toPageElement(el)
  );

  const forms = findForms(elements);
  const navigation = findNavigation(elements);

  // Extract content areas from visible text
  const contentAreas = extractContentAreas(observation.visibleText ?? []);

  // Use world state for enrichment if available
  const title =
    observation.title ??
    worldState?.facts.find((f) => f.startsWith("title:"))?.slice(6) ??
    "";
  const url = observation.pageUrl ?? worldState?.pageUrl ?? "";

  return {
    pageType,
    title,
    url,
    elements: pageElements,
    forms,
    navigation,
    contentAreas,
  };
}

function toPageElement(el: ActionableElementObservation): PageElement {
  const role = mapRole(el.role);
  return {
    role,
    text: el.text ?? "",
    selector: el.selector,
    interactable: isInteractable(el.role),
  };
}

function mapRole(
  role?: string
): PageElement["role"] {
  switch (role) {
    case "button":
      return "button";
    case "textbox":
    case "input":
    case "combobox":
    case "searchbox":
    case "spinbutton":
      return "input";
    case "link":
    case "menuitem":
      return "link";
    case "heading":
      return "heading";
    case "navigation":
    case "menu":
    case "menubar":
      return "navigation";
    case "form":
      return "form";
    case "alert":
    case "status":
      return "error_message";
    default:
      return "content";
  }
}

function isInteractable(role?: string): boolean {
  const interactableRoles = new Set([
    "button",
    "textbox",
    "input",
    "combobox",
    "searchbox",
    "spinbutton",
    "link",
    "menuitem",
    "checkbox",
    "radio",
    "slider",
    "switch",
    "tab",
  ]);
  return interactableRoles.has(role ?? "");
}

function extractContentAreas(visibleText: string[]): string[] {
  // Heuristic: non-trivial text lines that aren't navigation
  return visibleText
    .filter((line) => line.trim().length > 20)
    .slice(0, 10);
}
