import { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { useChat } from '../hooks/useChat';
import type { AgentEvent } from '../types';
import { Markdown } from '../components/Markdown';

// ── Types ────────────────────────────────────────────

interface TaskStep {
  id: string;
  type: string;
  summary: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  timestamp: string;
  durationMs?: number;
}

// ── Component ────────────────────────────────────────

export default function StudioPage() {
  const { state } = useApp();
  const chat = useChat();
  const [currentUrl, setCurrentUrl] = useState('');
  const [currentApp, setCurrentApp] = useState('');
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [currentScreenIdx, setCurrentScreenIdx] = useState(-1);
  const [isLive, setIsLive] = useState(true);
  const [steps, setSteps] = useState<TaskStep[]>([]);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [agentStatus, setAgentStatus] = useState<'idle' | 'working' | 'done'>('idle');
  const [agentMessage, setAgentMessage] = useState('');
  const screenRef = useRef<HTMLDivElement>(null);

  // Process events into steps and screenshots
  useEffect(() => {
    const evts = chat.events;
    const newSteps: TaskStep[] = [];
    const newScreens: string[] = [];
    let url = '';
    let app = '';

    for (const evt of evts) {
      if (evt.type === 'screenshot' && evt.screenshotDataUrl) {
        newScreens.push(evt.screenshotDataUrl);
      }
      if (evt.type === 'task_start') {
        const summary = evt.summary || evt.taskType || 'Task';
        newSteps.push({ id: (evt as any).taskId || `s-${newSteps.length}`, type: evt.taskType || '', summary, status: 'running', timestamp: evt.timestamp });
        // Extract URL from task
        if (evt.payload?.url) url = String(evt.payload.url);
        if (evt.taskType === 'open_page') { app = 'My Browser'; url = String(evt.payload?.url || url); }
        else if (evt.taskType === 'run_code') app = 'Terminal';
        else if (evt.taskType === 'http_request') app = 'HTTP Client';
        else if (evt.taskType) app = evt.taskType;
      }
      if (evt.type === 'task_done') {
        const last = [...newSteps].reverse().find((s: TaskStep) => s.status === 'running');
        if (last) { last.status = 'done'; last.durationMs = evt.durationMs; last.summary = evt.summary || last.summary; }
      }
      if (evt.type === 'task_failed') {
        const last = [...newSteps].reverse().find((s: TaskStep) => s.status === 'running');
        if (last) { last.status = 'failed'; last.summary = evt.error || last.summary; }
      }
      if (evt.type === 'planning' && evt.summary) {
        newSteps.push({ id: `plan-${newSteps.length}`, type: 'planning', summary: evt.summary, status: 'done', timestamp: evt.timestamp });
      }
    }

    setSteps(newSteps);
    setScreenshots(newScreens);
    if (newScreens.length > 0 && isLive) setCurrentScreenIdx(newScreens.length - 1);
    if (url) setCurrentUrl(url);
    if (app) setCurrentApp(app);
  }, [chat.events, isLive]);

  // Agent status
  useEffect(() => {
    if (chat.sending) setAgentStatus('working');
    else if (chat.messages.length > 0 && !chat.sending) setAgentStatus('done');
    else setAgentStatus('idle');
  }, [chat.sending, chat.messages.length]);

  // Last agent message
  useEffect(() => {
    const lastAssistant = [...chat.messages].reverse().find(m => m.role === 'assistant');
    if (lastAssistant) setAgentMessage(lastAssistant.content);
  }, [chat.messages]);

  const currentScreen = screenshots[currentScreenIdx] || null;
  const doneSteps = steps.filter(s => s.status === 'done').length;
  const totalSteps = steps.length;

  const handleSend = useCallback(() => {
    if (!inputText.trim()) return;
    chat.sendMessage(inputText.trim());
    setInputText('');
    setIsLive(true);
    setAgentStatus('working');
  }, [inputText, chat]);

  const jumpToLive = () => {
    setIsLive(true);
    if (screenshots.length > 0) setCurrentScreenIdx(screenshots.length - 1);
  };

  const handleTimelineChange = (idx: number) => {
    setCurrentScreenIdx(idx);
    setIsLive(idx === screenshots.length - 1);
  };

  return (
    <div className="flex-1 flex flex-col bg-gray-100 dark:bg-gray-900 overflow-hidden">

      {/* ── Top bar ── */}
      <div className="bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800 px-5 py-3 flex-shrink-0">
        <h2 className="text-lg font-bold mb-1">Agent 的电脑</h2>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <div className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
            <span>{agentStatus === 'working' ? 'Agent 正在使用' : agentStatus === 'done' ? 'Agent 已完成' : '等待指令'}</span>
            {currentApp && <span className="font-medium text-gray-700 dark:text-gray-300">{currentApp}</span>}
          </div>
          {currentUrl && (
            <>
              <span className="text-gray-300 dark:text-gray-700">|</span>
              <div className="flex items-center gap-1.5 min-w-0">
                <span>正在浏览</span>
                <span className="font-mono text-gray-700 dark:text-gray-300 truncate max-w-md">{currentUrl}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Main: Browser view ── */}
      <div className="flex-1 flex overflow-hidden">
        {/* Screen area */}
        <div className="flex-1 flex flex-col" ref={screenRef}>
          <div className="flex-1 relative bg-white dark:bg-gray-950 m-3 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm">
            {currentScreen ? (
              <>
                {/* URL bar */}
                <div className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-2 flex items-center gap-2">
                  <div className="flex gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-red-400" />
                    <div className="w-3 h-3 rounded-full bg-yellow-400" />
                    <div className="w-3 h-3 rounded-full bg-green-400" />
                  </div>
                  <div className="flex-1 bg-white dark:bg-gray-800 rounded-lg px-3 py-1 text-xs text-gray-500 font-mono truncate border border-gray-200 dark:border-gray-700">
                    {currentUrl || 'about:blank'}
                  </div>
                </div>
                {/* Screenshot */}
                <img
                  src={currentScreen}
                  alt="Agent browser"
                  className="w-full h-full object-contain bg-white"
                  style={{ maxHeight: 'calc(100% - 36px)' }}
                />
                {/* Live badge */}
                {isLive && agentStatus === 'working' && (
                  <div className="absolute top-12 right-3 flex items-center gap-1.5 bg-red-500 text-white text-xs px-2 py-1 rounded-full">
                    <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                    实时
                  </div>
                )}
              </>
            ) : (
              /* Empty state */
              <div className="flex flex-col items-center justify-center h-full text-gray-400">
                <svg className="w-20 h-20 mb-4 text-gray-200 dark:text-gray-700" fill="none" stroke="currentColor" strokeWidth="1" viewBox="0 0 24 24">
                  <rect x="2" y="3" width="20" height="14" rx="2" />
                  <path d="M8 21h8M12 17v4" />
                </svg>
                <p className="text-lg font-medium mb-2">Agent 的计算机</p>
                <p className="text-sm mb-6">输入任务后，在这里观看 Agent 实时操作计算机</p>
                <div className="flex gap-2 text-xs">
                  <button onClick={() => setInputText('Go to news.ycombinator.com and find the top 3 stories')}
                    className="px-3 py-1.5 bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition">
                    📰 浏览 Hacker News
                  </button>
                  <button onClick={() => setInputText('Go to example.com and take a screenshot')}
                    className="px-3 py-1.5 bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition">
                    📸 截图网页
                  </button>
                  <button onClick={() => setInputText('Search for latest AI news on Google')}
                    className="px-3 py-1.5 bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition">
                    🔍 搜索新闻
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── Timeline controls ── */}
          <div className="px-4 pb-3 flex-shrink-0">
            <div className="flex items-center gap-3">
              {/* Playback controls */}
              <button
                onClick={() => handleTimelineChange(Math.max(0, currentScreenIdx - 1))}
                disabled={screenshots.length === 0}
                className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-30"
                title="上一帧"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h2v12H6V6zm3.5 6l8.5 6V6l-8.5 6z"/></svg>
              </button>
              <button
                onClick={() => handleTimelineChange(Math.min(screenshots.length - 1, currentScreenIdx + 1))}
                disabled={screenshots.length === 0}
                className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-30"
                title="下一帧"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M16 18h2V6h-2v12zM6 18l8.5-6L6 6v12z"/></svg>
              </button>

              {/* Timeline slider */}
              <div className="flex-1 relative h-6 flex items-center">
                {screenshots.length > 1 ? (
                  <input
                    type="range"
                    min={0}
                    max={screenshots.length - 1}
                    value={currentScreenIdx >= 0 ? currentScreenIdx : 0}
                    onChange={e => handleTimelineChange(Number(e.target.value))}
                    className="w-full h-1 bg-gray-300 dark:bg-gray-700 rounded-full appearance-none cursor-pointer accent-blue-500"
                  />
                ) : (
                  <div className="w-full h-1 bg-gray-200 dark:bg-gray-800 rounded-full">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: screenshots.length > 0 ? '100%' : '0%' }} />
                  </div>
                )}
              </div>

              {/* Jump to live */}
              {!isLive && screenshots.length > 0 && (
                <button onClick={jumpToLive}
                  className="flex items-center gap-1 px-3 py-1 bg-gray-100 dark:bg-gray-800 rounded-full text-xs hover:bg-gray-200 dark:hover:bg-gray-700 transition">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                  跳到实时
                </button>
              )}

              {/* Live indicator */}
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <span className={`w-2 h-2 rounded-full ${isLive && agentStatus === 'working' ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
                <span>{isLive ? '实时' : `${currentScreenIdx + 1}/${screenshots.length}`}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Right sidebar: Steps + Chat ── */}
        <div className="w-80 border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 flex flex-col flex-shrink-0">
          {/* Steps list */}
          <div className="flex-1 overflow-y-auto p-3 space-y-1">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">任务步骤</h3>
            {steps.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-8">发送任务后显示执行步骤</p>
            ) : (
              steps.map((step, i) => (
                <div key={step.id}
                  className={`rounded-lg p-2.5 text-xs cursor-pointer transition ${expandedStep === step.id ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}
                  onClick={() => setExpandedStep(expandedStep === step.id ? null : step.id)}
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 flex-shrink-0">
                      {step.status === 'done' ? (
                        <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>
                      ) : step.status === 'failed' ? (
                        <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
                      ) : step.status === 'running' ? (
                        <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <div className="w-4 h-4 rounded-full border-2 border-gray-300" />
                      )}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className={`font-medium ${step.status === 'done' ? 'text-gray-700 dark:text-gray-300' : step.status === 'failed' ? 'text-red-600' : 'text-blue-600'}`}>
                          {step.summary.slice(0, 50)}
                        </span>
                        <span className="text-gray-400 ml-2 flex-shrink-0">
                          {i + 1}/{totalSteps}
                        </span>
                      </div>
                      {step.durationMs && (
                        <span className="text-gray-400">{(step.durationMs / 1000).toFixed(1)}s</span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}

            {/* Agent response */}
            {agentMessage && agentStatus === 'done' && (
              <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-900 rounded-xl">
                <h4 className="text-xs font-semibold text-gray-500 mb-2">Agent 回复</h4>
                <div className="text-xs prose-msg">
                  <Markdown content={agentMessage} />
                </div>
              </div>
            )}
          </div>

          {/* Bottom step summary */}
          {steps.length > 0 && (
            <div className="border-t border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center gap-2">
              {agentStatus === 'done' ? (
                <svg className="w-5 h-5 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>
              ) : (
                <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
              )}
              <span className="text-sm flex-1 truncate">
                {steps[steps.length - 1]?.summary.slice(0, 40) || '处理中...'}
              </span>
              <span className="text-xs text-gray-500 flex-shrink-0">{doneSteps} / {totalSteps}</span>
            </div>
          )}

          {/* Input */}
          <div className="border-t border-gray-200 dark:border-gray-800 p-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
                placeholder="输入任务指令..."
                className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 dark:bg-gray-800 rounded-xl focus:outline-none focus:border-blue-400 transition"
                disabled={chat.sending}
              />
              <button
                onClick={handleSend}
                disabled={!inputText.trim() || chat.sending}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white text-sm rounded-xl transition disabled:cursor-not-allowed"
              >
                {chat.sending ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : '发送'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
