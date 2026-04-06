import {
  createContext,
  useContext,
  useReducer,
  type ReactNode,
  type Dispatch,
} from 'react';
import type { Conversation, Message, AgentEvent, Settings, Stage } from '../types';

// ── State shape ───────────────────────────────────────────────

export interface AppState {
  conversations: Conversation[];
  activeConvoId: string | null;
  messages: Message[];

  runId: string | null;
  events: AgentEvent[];
  stage: Stage;
  sending: boolean;
  tasksDone: number;
  tasksTotal: number;

  settings: Settings;

  jwtToken: string | null;
  jwtUser: { email: string; role: string } | null;

  stageStartTime: number | null;
}

const DEFAULT_SETTINGS: Settings = {
  dark: false,
  notify: false,
  sound: false,
  mode: '',
  apiKey: '',
  agentName: 'Agent',
  sidebarOpen: true,
  panelOpen: true,
  lang: 'en',
};

function loadSettings(): Settings {
  try {
    const stored = localStorage.getItem('agentSettings');
    return { ...DEFAULT_SETTINGS, ...(stored ? JSON.parse(stored) : {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function loadAuth(): { token: string | null; user: { email: string; role: string } | null } {
  try {
    const token = localStorage.getItem('jwtToken');
    if (!token) return { token: null, user: null };
    const payload = JSON.parse(atob(token.split('.')[1]));
    return { token, user: { email: payload.email ?? '', role: payload.role ?? 'user' } };
  } catch {
    return { token: null, user: null };
  }
}

const initialAuth = loadAuth();

const initialState: AppState = {
  conversations: [],
  activeConvoId: null,
  messages: [],

  runId: null,
  events: [],
  stage: 'idle',
  sending: false,
  tasksDone: 0,
  tasksTotal: 0,

  settings: loadSettings(),

  jwtToken: initialAuth.token,
  jwtUser: initialAuth.user,

  stageStartTime: null,
};

// ── Actions ───────────────────────────────────────────────────

export type AppAction =
  | { type: 'SET_CONVERSATIONS'; conversations: Conversation[] }
  | { type: 'SET_ACTIVE_CONVO'; id: string | null }
  | { type: 'ADD_MESSAGE'; message: Message }
  | { type: 'UPDATE_LAST_MESSAGE'; content: string; done?: boolean }
  | { type: 'SET_RUN_ID'; runId: string | null }
  | { type: 'ADD_EVENT'; event: AgentEvent }
  | { type: 'SET_STAGE'; stage: Stage }
  | { type: 'SET_SENDING'; sending: boolean }
  | { type: 'SET_SETTINGS'; settings: Partial<Settings> }
  | { type: 'SET_AUTH'; token: string; user: { email: string; role: string } }
  | { type: 'LOGOUT' }
  | { type: 'NEW_CHAT' }
  | { type: 'FINISH_MESSAGE'; success?: boolean }
  | { type: 'INCREMENT_TASKS_DONE' }
  | { type: 'SET_TASKS_TOTAL'; total: number }
  | { type: 'SET_MESSAGES'; messages: Message[] };

// ── Reducer ───────────────────────────────────────────────────

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_CONVERSATIONS':
      return { ...state, conversations: action.conversations };

    case 'SET_ACTIVE_CONVO':
      return { ...state, activeConvoId: action.id };

    case 'ADD_MESSAGE':
      return { ...state, messages: [...state.messages, action.message] };

    case 'UPDATE_LAST_MESSAGE': {
      if (state.messages.length === 0) return state;
      const msgs = [...state.messages];
      const last = { ...msgs[msgs.length - 1] };
      last.content += action.content;
      if (action.done) {
        last.timestamp = new Date().toISOString();
      }
      msgs[msgs.length - 1] = last;
      return { ...state, messages: msgs };
    }

    case 'SET_MESSAGES':
      return { ...state, messages: action.messages };

    case 'SET_RUN_ID':
      return {
        ...state,
        runId: action.runId,
        events: action.runId ? [] : state.events,
        tasksDone: action.runId ? 0 : state.tasksDone,
        tasksTotal: action.runId ? 0 : state.tasksTotal,
        stageStartTime: action.runId ? Date.now() : null,
      };

    case 'ADD_EVENT':
      return { ...state, events: [...state.events, action.event] };

    case 'SET_STAGE':
      return { ...state, stage: action.stage };

    case 'SET_SENDING':
      return { ...state, sending: action.sending };

    case 'SET_SETTINGS': {
      const merged = { ...state.settings, ...action.settings };
      localStorage.setItem('agentSettings', JSON.stringify(merged));
      return { ...state, settings: merged };
    }

    case 'SET_AUTH':
      localStorage.setItem('jwtToken', action.token);
      return { ...state, jwtToken: action.token, jwtUser: action.user };

    case 'LOGOUT':
      localStorage.removeItem('jwtToken');
      return { ...state, jwtToken: null, jwtUser: null };

    case 'NEW_CHAT':
      return {
        ...state,
        activeConvoId: null,
        messages: [],
        runId: null,
        events: [],
        stage: 'idle',
        sending: false,
        tasksDone: 0,
        tasksTotal: 0,
        stageStartTime: null,
      };

    case 'FINISH_MESSAGE': {
      if (state.messages.length === 0) return state;
      const msgs = [...state.messages];
      const last = { ...msgs[msgs.length - 1] };
      last.success = action.success;
      last.timestamp = new Date().toISOString();
      msgs[msgs.length - 1] = last;
      return {
        ...state,
        messages: msgs,
        sending: false,
        stage: 'idle',
        stageStartTime: null,
        tasksDone: 0,
        tasksTotal: 0,
      };
    }

    case 'INCREMENT_TASKS_DONE':
      return { ...state, tasksDone: state.tasksDone + 1 };

    case 'SET_TASKS_TOTAL':
      return { ...state, tasksTotal: action.total };

    default:
      return state;
  }
}

// ── Context ───────────────────────────────────────────────────

interface AppContextValue {
  state: AppState;
  dispatch: Dispatch<AppAction>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return ctx;
}
