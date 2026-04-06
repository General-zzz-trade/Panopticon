import React, { useState, useRef, useCallback, useEffect } from 'react';
import type { Attachment } from '../types';

const SLASH_COMMANDS = [
  { cmd: 'Go to ',               desc: 'Open URL' },
  { cmd: 'Fetch ',               desc: 'HTTP request' },
  { cmd: 'Search for ',          desc: 'Web search' },
  { cmd: 'Read file ',           desc: 'Read file' },
  { cmd: 'Take a screenshot of ',desc: 'Screenshot' },
  { cmd: 'Run command ',         desc: 'Shell' },
];

interface InputComposerProps {
  onSend: (text: string, attachments?: Attachment[]) => void;
  disabled?: boolean;
  history?: string[];
}

export function InputComposer({ onSend, disabled = false, history = [] }: InputComposerProps) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashMatches, setSlashMatches] = useState(SLASH_COMMANDS);
  const [slashIdx, setSlashIdx] = useState(0);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canSend = (text.trim().length > 0 || attachments.length > 0) && !disabled && !sending;

  // Auto-grow textarea
  const adjustHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [text, adjustHeight]);

  // --- Slash command menu ---
  const updateSlashMenu = useCallback(
    (value: string) => {
      if (value.startsWith('/') && !value.includes(' ')) {
        const q = value.slice(1).toLowerCase();
        const matches = SLASH_COMMANDS.filter(
          (c) => c.cmd.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q),
        ).slice(0, 6);
        if (matches.length) {
          setSlashMatches(matches);
          setSlashIdx(0);
          setSlashOpen(true);
          return;
        }
      }
      setSlashOpen(false);
    },
    [],
  );

  // --- Typeahead suggestions ---
  const updateSuggestions = useCallback(
    (value: string) => {
      const v = value.trim();
      if (v.length < 3 || v.startsWith('/')) {
        setSuggestOpen(false);
        return;
      }
      const matches = history
        .filter((h) => h.toLowerCase().includes(v.toLowerCase()) && h !== v)
        .slice(0, 4);
      if (matches.length) {
        setSuggestions(matches);
        setSuggestOpen(true);
      } else {
        setSuggestOpen(false);
      }
    },
    [history],
  );

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    setHistoryIdx(-1);
    updateSlashMenu(val);
    updateSuggestions(val);
  };

  const doSend = useCallback(() => {
    if (!canSend) return;
    setSending(true);
    const sendText = text.trim();
    const sendAtts = attachments.length > 0 ? [...attachments] : undefined;
    setText('');
    setAttachments([]);
    setSuggestOpen(false);
    setSlashOpen(false);
    onSend(sendText, sendAtts);
    setSending(false);
  }, [canSend, text, attachments, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Slash menu navigation
    if (slashOpen) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashOpen(false);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const match = slashMatches[slashIdx];
        if (match) {
          setText(match.cmd);
          setSlashOpen(false);
          textareaRef.current?.focus();
        }
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIdx((prev) => (prev + 1) % slashMatches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIdx((prev) => (prev - 1 + slashMatches.length) % slashMatches.length);
        return;
      }
    }

    // Suggestion dropdown
    if (suggestOpen && e.key === 'Escape') {
      e.preventDefault();
      setSuggestOpen(false);
      return;
    }

    // Send on Enter (no modifier)
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      doSend();
      return;
    }

    // History navigation
    if (e.key === 'ArrowUp' && text === '' && history.length > 0) {
      e.preventDefault();
      const nextIdx = Math.min(historyIdx + 1, history.length - 1);
      setHistoryIdx(nextIdx);
      setText(history[nextIdx]);
      return;
    }
    if (e.key === 'ArrowDown' && historyIdx >= 0) {
      e.preventDefault();
      const nextIdx = historyIdx - 1;
      setHistoryIdx(nextIdx);
      setText(nextIdx < 0 ? '' : history[nextIdx]);
      return;
    }
  };

  // --- File handling ---
  const addFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      setAttachments((prev) => [
        ...prev,
        {
          name: file.name,
          type: file.type,
          size: file.size,
          dataUrl: reader.result as string,
        },
      ]);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach(addFile);
    e.target.value = '';
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          addFile(file);
          e.preventDefault();
        }
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.add('border-blue-500');
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.currentTarget.classList.remove('border-blue-500');
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.remove('border-blue-500');
    Array.from(e.dataTransfer.files).forEach(addFile);
  };

  const removeAttachment = (idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  return (
    <div className="border-t border-gray-200 p-4 dark:border-gray-700">
      {/* Attachment preview strip */}
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((att, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 rounded-lg bg-gray-100 px-2 py-1 text-xs dark:bg-gray-800"
            >
              <span>{att.type.startsWith('image/') ? '\ud83d\uddbc' : '\ud83d\udcc4'}</span>
              <span className="max-w-[10rem] truncate">{att.name}</span>
              <button
                className="ml-1 text-gray-500 hover:text-red-600"
                onClick={() => removeAttachment(i)}
              >
                \u00d7
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="relative">
        {/* Slash command dropdown */}
        {slashOpen && (
          <div className="absolute bottom-full left-0 z-50 mb-1 w-64 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
            {slashMatches.map((cmd, i) => (
              <div
                key={cmd.cmd}
                className={`cursor-pointer px-3 py-2 text-sm ${
                  i === slashIdx
                    ? 'bg-gray-100 dark:bg-gray-800'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setText(cmd.cmd);
                  setSlashOpen(false);
                  textareaRef.current?.focus();
                }}
              >
                <div className="font-mono text-xs">{cmd.cmd}</div>
                <div className="text-xs text-gray-500">{cmd.desc}</div>
              </div>
            ))}
          </div>
        )}

        {/* Typeahead suggestions dropdown */}
        {suggestOpen && !slashOpen && (
          <div className="absolute bottom-full left-0 z-50 mb-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
            {suggestions.map((s, i) => (
              <div
                key={i}
                className="cursor-pointer truncate px-3 py-2 text-xs hover:bg-gray-100 dark:hover:bg-gray-800"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setText(s);
                  setSuggestOpen(false);
                  textareaRef.current?.focus();
                }}
              >
                {s}
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-3">
          {/* Attach button */}
          <button
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            title="Attach file"
            onClick={() => fileInputRef.current?.click()}
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
              />
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            multiple
            onChange={handleFileChange}
          />

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            className="flex-1 resize-none rounded-lg border border-gray-300 bg-white p-3 text-sm text-gray-900 placeholder-gray-500 transition focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            placeholder="Type a message... (/ for commands)"
            rows={1}
            value={text}
            disabled={disabled || sending}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          />

          {/* Send button */}
          <button
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white transition hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={!canSend}
            onClick={doSend}
            title="Send message"
          >
            {sending ? (
              <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            ) : (
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
