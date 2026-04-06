import { useRef, useEffect, useCallback, useState } from 'react';
import type { Message, AgentEvent, Attachment } from '../types';
import { MessageBubble } from './MessageBubble';
import { InputComposer } from './InputComposer';
import { loadModelConfig } from './ModelSettings';

const SUGGESTIONS = [
  { icon: '🌐', title: '浏览网页', titleEn: 'Browse Web', desc: '访问任意URL并提取信息', descEn: 'Visit any URL and extract info', prompt: 'Go to example.com and summarize what it says', color: 'from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30', iconBg: 'bg-blue-100 dark:bg-blue-900/40' },
  { icon: '📊', title: '数据采集', titleEn: 'Data Collection', desc: '自动抓取和分析数据', descEn: 'Scrape and analyze data', prompt: 'Fetch the GitHub API for the Node.js repository info', color: 'from-orange-50 to-amber-50 dark:from-orange-950/30 dark:to-amber-950/30', iconBg: 'bg-orange-100 dark:bg-orange-900/40' },
  { icon: '🖥', title: '代码分析', titleEn: 'Code Analysis', desc: '分析项目结构和代码', descEn: 'Analyze project structure', prompt: 'List all TypeScript files in src/ and count lines', color: 'from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30', iconBg: 'bg-green-100 dark:bg-green-900/40' },
  { icon: '📧', title: '自动任务', titleEn: 'Automation', desc: '执行Shell命令和脚本', descEn: 'Run shell commands', prompt: 'Run command: echo "Hello from Panopticon"', color: 'from-purple-50 to-pink-50 dark:from-purple-950/30 dark:to-pink-950/30', iconBg: 'bg-purple-100 dark:bg-purple-900/40' },
  { icon: '📸', title: '截图监控', titleEn: 'Screenshot', desc: '网页截图与页面监控', descEn: 'Capture and monitor pages', prompt: 'Go to news.ycombinator.com and find the top 3 stories', color: 'from-cyan-50 to-sky-50 dark:from-cyan-950/30 dark:to-sky-950/30', iconBg: 'bg-cyan-100 dark:bg-cyan-900/40' },
];

interface ChatAreaProps {
  messages: Message[];
  events: AgentEvent[];
  isStreaming?: boolean;
  streamingContent?: string;
  streamingRunId?: string;
  history?: string[];
  disabled?: boolean;
  onSend: (text: string, attachments?: Attachment[]) => void;
  onEdit?: (messageId: string, content: string) => void;
  onFork?: (messageId: string) => void;
  onFeedback?: (messageId: string, rating: 'up' | 'down') => void;
  onRetry?: (messageId: string) => void;
  onInspectEvent?: (event: AgentEvent) => void;
  onOpenModelSettings?: () => void;
}

export function ChatArea({
  messages, events, isStreaming = false, streamingContent, streamingRunId,
  history = [], disabled = false, onSend, onEdit, onFork, onFeedback, onRetry, onInspectEvent, onOpenModelSettings,
}: ChatAreaProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [setupChecked, setSetupChecked] = useState(false);
  const [openModelSettingsFlag, setOpenModelSettingsFlag] = useState(0);

  const handleOpenModelSettings = useCallback(() => {
    if (onOpenModelSettings) {
      onOpenModelSettings();
    } else {
      // Trigger InputComposer's modal via a counter flag
      setOpenModelSettingsFlag(f => f + 1);
    }
  }, [onOpenModelSettings]);

  // Check if user needs first-run setup
  useEffect(() => {
    const mc = loadModelConfig();
    if (mc.mode && mc.mode !== 'default') {
      // Custom model configured, no setup needed
      setNeedsSetup(false);
      setSetupChecked(true);
      return;
    }
    // Mode is default — check if backend has env LLM configured
    fetch('/health')
      .then(r => r.json())
      .then(data => {
        // If health endpoint indicates LLM is configured (status ok), skip setup
        // Otherwise show setup guide
        const hasEnvLLM = data.llmConfigured === true;
        setNeedsSetup(!hasEnvLLM);
        setSetupChecked(true);
      })
      .catch(() => {
        // Can't reach backend, show setup guide
        setNeedsSetup(true);
        setSetupChecked(true);
      });
  }, []);

  const skipSetup = useCallback(() => {
    setNeedsSetup(false);
    localStorage.setItem('setupSkipped', 'true');
  }, []);

  // Also skip if user previously dismissed
  useEffect(() => {
    if (localStorage.getItem('setupSkipped') === 'true') {
      setNeedsSetup(false);
    }
  }, []);

  // Check for pendingGoal from template run redirect
  useEffect(() => {
    const pendingGoal = localStorage.getItem('pendingGoal');
    if (pendingGoal && !disabled) {
      localStorage.removeItem('pendingGoal');
      const timer = setTimeout(() => {
        onSend(pendingGoal);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streamingContent]);

  const isEmpty = messages.length === 0 && !isStreaming;

  const eventsForRun = (runId?: string): AgentEvent[] => {
    if (!runId) return [];
    return events.filter(e => e.runId === runId);
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">
      <div className="flex-1 overflow-y-auto">
        {isEmpty ? (
          /* ── QClaw-style empty state ── */
          <div className="flex flex-col items-center justify-center h-full px-6">
            {/* Welcome text */}
            <div className="text-center mb-12 mt-[-40px]">
              <h1 className="text-4xl font-bold text-gray-900 dark:text-gray-100 mb-3">
                Hi，我是 <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">Agent</span>
                <span className="inline-block ml-1 text-yellow-400 animate-pulse">✦</span>
              </h1>
              <p className="text-gray-400 text-lg">随时随地，帮您高效干活</p>
            </div>

            {setupChecked && needsSetup ? (
              /* ── First-run setup guide ── */
              <div className="w-full max-w-md">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-6 text-center">
                  🚀 开始使用 <span className="text-sm font-normal text-gray-400 ml-2">Get Started</span>
                </h2>
                <div className="space-y-4">
                  {/* Step 1 & 2: Configure model + API key */}
                  <div className="flex items-start gap-4 p-4 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
                    <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-sm font-bold text-blue-600 flex-shrink-0">1</div>
                    <div className="flex-1">
                      <div className="font-medium text-sm text-gray-900 dark:text-gray-100 mb-1">选择你的大模型 & 输入 API Key</div>
                      <div className="text-xs text-gray-500 mb-3">支持 OpenAI、Anthropic、DeepSeek 等主流模型</div>
                      <button
                        onClick={handleOpenModelSettings}
                        className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition"
                      >
                        配置大模型
                      </button>
                    </div>
                  </div>

                  {/* Step 3: Send first message */}
                  <div className="flex items-start gap-4 p-4 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
                    <div className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center text-sm font-bold text-green-600 flex-shrink-0">2</div>
                    <div className="flex-1">
                      <div className="font-medium text-sm text-gray-900 dark:text-gray-100 mb-1">发送第一条消息</div>
                      <div className="text-xs text-gray-500">
                        试试输入: <button onClick={() => onSend('Go to example.com and summarize what it says')} className="text-blue-500 hover:underline">"Go to example.com and summarize what it says"</button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Skip link */}
                <div className="text-center mt-6">
                  <button onClick={skipSetup} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition">
                    跳过，使用默认配置
                  </button>
                </div>
              </div>
            ) : (
              /* ── Suggestion cards — horizontal scroll ── */
              <div className="w-full max-w-5xl overflow-x-auto pb-4">
                <div className="flex gap-4 px-4 min-w-max">
                  {SUGGESTIONS.map((s, i) => (
                    <button key={i} onClick={() => onSend(s.prompt)}
                      className={`group flex-shrink-0 w-48 rounded-2xl p-5 text-left bg-gradient-to-br ${s.color} border border-white/60 dark:border-gray-800 hover:shadow-lg hover:scale-[1.02] transition-all duration-200`}>
                      <div className={`w-10 h-10 ${s.iconBg} rounded-xl flex items-center justify-center text-xl mb-3`}>
                        {s.icon}
                      </div>
                      <div className="font-semibold text-sm text-gray-900 dark:text-gray-100 mb-1">{s.title}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{s.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* ── Message list ── */
          <div className="max-w-3xl mx-auto px-4 py-6 space-y-1">
            {messages.map((msg, idx) => {
              const isLastAssistant = msg.role === 'assistant' && idx === messages.length - 1 && isStreaming && msg.runId === streamingRunId;
              return (
                <MessageBubble key={msg.id} message={msg} events={eventsForRun(msg.runId)}
                  isStreaming={isLastAssistant} streamingContent={isLastAssistant ? streamingContent : undefined}
                  onEdit={onEdit ? c => onEdit(msg.id, c) : undefined}
                  onFork={onFork ? () => onFork(msg.id) : undefined}
                  onFeedback={msg.role === 'assistant' && onFeedback ? r => onFeedback(msg.id, r) : undefined}
                  onRetry={msg.role === 'assistant' && msg.success === false && onRetry ? () => onRetry(msg.id) : undefined}
                  onInspectEvent={onInspectEvent}
                />
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* ── Input area (QClaw style) ── */}
      <div className="border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3">
        <div className="max-w-3xl mx-auto">
          <InputComposer onSend={onSend} disabled={disabled || isStreaming} history={history} onOpenModelSettings={handleOpenModelSettings} openModelSettingsTrigger={openModelSettingsFlag} />
        </div>
      </div>
    </div>
  );
}
