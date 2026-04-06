import React from "react";
import { Modal } from "./Modal";

const SHORTCUTS: { label: string; keys: string }[] = [
  { label: "Focus input", keys: "Ctrl+K" },
  { label: "Toggle sidebar", keys: "Ctrl+B" },
  { label: "Toggle panel", keys: "Ctrl+." },
  { label: "Settings", keys: "Ctrl+," },
  { label: "Shortcuts", keys: "Ctrl+/" },
  { label: "New chat", keys: "Ctrl+N" },
  { label: "Send message", keys: "Enter" },
  { label: "New line", keys: "Shift+Enter" },
  { label: "History up/down", keys: "\u2191/\u2193" },
  { label: "Close modal", keys: "Esc" },
];

export function Shortcuts({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard Shortcuts" maxWidth="max-w-sm">
      <div className="space-y-2 text-sm">
        {SHORTCUTS.map((s) => (
          <div
            key={s.keys}
            className="flex items-center justify-between"
          >
            <span className="text-gray-700 dark:text-gray-300">
              {s.label}
            </span>
            <kbd className="font-mono text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded">
              {s.keys}
            </kbd>
          </div>
        ))}
      </div>
    </Modal>
  );
}
