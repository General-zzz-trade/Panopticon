export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  runId?: string;
  success?: boolean;
  attachments?: Attachment[];
}

export interface Attachment {
  name: string;
  type: string;
  size: number;
  dataUrl: string;
}

export interface Conversation {
  id: string;
  summary: string;
  createdAt: string;
  lastActiveAt: string;
  turns: number;
}

export interface AgentEvent {
  type: string;
  runId: string;
  seq?: number;
  timestamp: string;
  summary?: string;
  message?: string;
  taskType?: string;
  durationMs?: number;
  error?: string;
  payload?: Record<string, unknown>;
  screenshotDataUrl?: string;
  success?: boolean;
  content?: string;
}

export interface Settings {
  dark: boolean;
  notify: boolean;
  sound: boolean;
  mode: string;
  apiKey: string;
  agentName: string;
  sidebarOpen: boolean;
  panelOpen: boolean;
  lang: 'en' | 'zh';
}

export type Stage = 'idle' | 'planning' | 'executing' | 'verifying' | 'done';
