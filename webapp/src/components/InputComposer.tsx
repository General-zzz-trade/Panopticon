import React, { useState, useRef, useCallback, useEffect } from 'react';
import type { Attachment } from '../types';
import { ModelSettings, loadModelConfig, type ModelConfig } from './ModelSettings';

const SLASH_COMMANDS = [
  { cmd: 'Go to ', desc: 'Open URL' },
  { cmd: 'Fetch ', desc: 'HTTP request' },
  { cmd: 'Search for ', desc: 'Web search' },
  { cmd: 'Read file ', desc: 'Read file' },
  { cmd: 'Take a screenshot of ', desc: 'Screenshot' },
  { cmd: 'Run command ', desc: 'Shell' },
];

interface InputComposerProps {
  onSend: (text: string, attachments?: Attachment[]) => void;
  disabled?: boolean;
  history?: string[];
  onOpenModelSettings?: () => void;
  /** Increment this counter to externally trigger the model settings modal */
  openModelSettingsTrigger?: number;
}

export function InputComposer({ onSend, disabled = false, history = [], onOpenModelSettings, openModelSettingsTrigger = 0 }: InputComposerProps) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const [modelModalOpen, setModelModalOpen] = useState(false);
  const [modelConfig, setModelConfig] = useState<ModelConfig>(loadModelConfig);
  const [showSlash, setShowSlash] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);
  const [histIdx, setHistIdx] = useState(-1);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Open model settings modal when externally triggered
  useEffect(() => {
    if (openModelSettingsTrigger > 0) {
      setModelModalOpen(true);
    }
  }, [openModelSettingsTrigger]);

  const canSend = (text.trim().length > 0 || attachments.length > 0) && !disabled && !sending;

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
  }, [text]);

  const doSend = useCallback(() => {
    if (!canSend) return;
    setSending(true);
    onSend(text.trim(), attachments.length > 0 ? attachments : undefined);
    setText('');
    setAttachments([]);
    setSending(false);
    setHistIdx(-1);
  }, [canSend, text, attachments, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showSlash) {
      if (e.key === 'Escape') { setShowSlash(false); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIdx(i => (i + 1) % SLASH_COMMANDS.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIdx(i => (i - 1 + SLASH_COMMANDS.length) % SLASH_COMMANDS.length); return; }
      if (e.key === 'Enter') { e.preventDefault(); setText(SLASH_COMMANDS[slashIdx].cmd); setShowSlash(false); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); return; }
    if (e.key === 'ArrowUp' && text === '' && history.length > 0) { e.preventDefault(); const idx = Math.min(histIdx + 1, history.length - 1); setHistIdx(idx); setText(history[idx]); }
    if (e.key === 'ArrowDown' && histIdx >= 0) { e.preventDefault(); const idx = histIdx - 1; setHistIdx(idx); setText(idx < 0 ? '' : history[idx]); }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    setShowSlash(val.startsWith('/') && !val.includes(' '));
    setSlashIdx(0);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    for (const item of e.clipboardData.items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) addFile(file);
        e.preventDefault();
      }
    }
  };

  const addFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => setAttachments(a => [...a, { name: file.name, type: file.type, size: file.size, dataUrl: reader.result as string }]);
    reader.readAsDataURL(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    for (const f of Array.from(e.target.files || [])) addFile(f);
    e.target.value = '';
  };

  return (
    <div>
      {/* Slash command dropdown */}
      {showSlash && (
        <div className="mb-2 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 shadow-lg overflow-hidden">
          {SLASH_COMMANDS.filter(c => {
            const q = text.slice(1).toLowerCase();
            return !q || c.cmd.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q);
          }).map((c, i) => (
            <button key={c.cmd} onClick={() => { setText(c.cmd); setShowSlash(false); textareaRef.current?.focus(); }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition ${i === slashIdx ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
              <span className="text-gray-400 mono text-xs">/</span>
              <span className="font-medium">{c.cmd.trim()}</span>
              <span className="text-gray-400 text-xs">{c.desc}</span>
            </button>
          ))}
        </div>
      )}

      {/* Attachment chips */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {attachments.map((a, i) => (
            <div key={i} className="flex items-center gap-1.5 bg-gray-100 dark:bg-gray-800 rounded-lg px-2.5 py-1 text-xs">
              <span>{a.type.startsWith('image/') ? '🖼' : '📄'}</span>
              <span className="max-w-24 truncate">{a.name}</span>
              <button onClick={() => setAttachments(at => at.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500 ml-0.5">×</button>
            </div>
          ))}
        </div>
      )}

      {/* Input box */}
      <div className="relative border border-gray-200 dark:border-gray-700 rounded-2xl bg-white dark:bg-gray-800 focus-within:border-blue-300 dark:focus-within:border-blue-700 focus-within:ring-2 focus-within:ring-blue-100 dark:focus-within:ring-blue-900/30 transition">
        <textarea ref={textareaRef}
          className="w-full resize-none bg-transparent px-4 pt-3 pb-2 text-sm placeholder-gray-400 focus:outline-none"
          placeholder="可以描述任务或提问任何问题"
          rows={1}
          value={text}
          disabled={disabled || sending}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); for (const f of Array.from(e.dataTransfer.files)) addFile(f); }}
        />

        {/* Bottom toolbar inside input box */}
        <div className="flex items-center justify-between px-3 pb-2">
          <div className="flex items-center gap-1">
            {/* Model selector */}
            <button onClick={() => setModelModalOpen(true)} className="flex items-center gap-1 px-2.5 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
              <span>{modelConfig.mode === 'default' ? '默认大模型' : modelConfig.providerName || '自定义模型'}</span>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7"/></svg>
            </button>

            {/* Skills */}
            <button className="flex items-center gap-1 px-2.5 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5"/></svg>
              <span>技能</span>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7"/></svg>
            </button>

            {/* Attach */}
            <button onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1 px-2.5 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
            </button>
            <input ref={fileInputRef} type="file" className="hidden" multiple onChange={handleFileChange} />
          </div>

          {/* Send button */}
          <button disabled={!canSend} onClick={doSend}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white transition disabled:cursor-not-allowed">
            {sending ? (
              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
            )}
          </button>
        </div>
      </div>

      {/* Disclaimer / demo mode hint */}
      {modelConfig.mode === 'default' ? (
        <p className="text-center text-[10px] text-gray-400 mt-2">
          💡 使用默认模型 ·{' '}
          <button
            onClick={() => { onOpenModelSettings ? onOpenModelSettings() : setModelModalOpen(true); }}
            className="text-blue-500 hover:text-blue-600 hover:underline transition"
          >
            配置自定义模型
          </button>
        </p>
      ) : (
        <p className="text-center text-[10px] text-gray-400 mt-2">内容由AI生成，请仔细甄别</p>
      )}

      {/* Model settings modal */}
      <ModelSettings
        open={modelModalOpen}
        onClose={() => setModelModalOpen(false)}
        onSave={(cfg) => setModelConfig(cfg)}
      />
    </div>
  );
}
