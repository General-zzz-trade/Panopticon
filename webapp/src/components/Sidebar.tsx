import React, { useState, useCallback, useEffect, useRef } from "react";
import type { Conversation, Settings } from "../types";

interface SidebarProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  settings: Settings;
  healthStatus?: { ok: boolean; text: string };
  authUser?: string | null;
  onNewChat: () => void;
  onSelectConvo: (id: string) => void;
  onDeleteConvo: (id: string) => void;
  onReorderConvos?: (convos: Conversation[]) => void;
  onOpenSettings: () => void;
  onOpenDashboard: () => void;
  onToggleTheme: () => void;
  onToggleLang: () => void;
}

export function Sidebar({
  conversations,
  activeConversationId,
  settings,
  healthStatus,
  authUser,
  onNewChat,
  onSelectConvo,
  onDeleteConvo,
  onReorderConvos,
  onOpenSettings,
  onOpenDashboard,
  onToggleTheme,
  onToggleLang,
}: SidebarProps) {
  const [search, setSearch] = useState("");
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Filtered conversations
  const filtered = search.trim()
    ? conversations.filter((c) =>
        (c.summary || c.id || "").toLowerCase().includes(search.toLowerCase())
      )
    : conversations;

  // --- Drag-to-reorder handlers ---
  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLDivElement>, idx: number) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(idx));
      setDragIdx(idx);
    },
    []
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>, idx: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDragOverIdx(idx);
    },
    []
  );

  const handleDragLeave = useCallback(() => {
    setDragOverIdx(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>, toIdx: number) => {
      e.preventDefault();
      setDragOverIdx(null);
      setDragIdx(null);
      const fromIdx = Number(e.dataTransfer.getData("text/plain"));
      if (fromIdx === toIdx || isNaN(fromIdx)) return;
      const reordered = [...conversations];
      const [moved] = reordered.splice(fromIdx, 1);
      reordered.splice(toIdx, 0, moved);
      onReorderConvos?.(reordered);
    },
    [conversations, onReorderConvos]
  );

  const handleDragEnd = useCallback(() => {
    setDragIdx(null);
    setDragOverIdx(null);
  }, []);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">

      {/* New chat button */}
      <div className="p-3 border-b border-gray-200 dark:border-gray-800">
        <button
          onClick={onNewChat}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-800 rounded-lg transition"
          aria-label="New chat"
        >
          <span className="text-lg leading-none">+</span>
          <span>New chat</span>
        </button>
      </div>

      {/* Search input */}
      <div className="px-3 pt-2">
        <input
          type="search"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-2.5 py-1.5 text-xs border border-gray-200 dark:border-gray-700 dark:bg-gray-800 rounded-lg focus:outline-none focus:border-blue-500"
          aria-label="Search conversations"
        />
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto scroll-thin p-2" ref={listRef}>
        <div className="space-y-0.5">
          {filtered.length === 0 && (
            <p className="text-xs text-gray-400 px-3 py-2">
              {search ? "No matches" : "No conversations"}
            </p>
          )}
          {filtered.map((convo, idx) => {
            const isActive = convo.id === activeConversationId;
            const isDragging = dragIdx === idx;
            const isDragOver = dragOverIdx === idx;

            return (
              <div
                key={convo.id}
                className={`flex items-center group ${
                  isDragOver ? "border-t-2 border-blue-500" : ""
                }`}
                draggable
                onDragStart={(e) => handleDragStart(e, idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, idx)}
                onDragEnd={handleDragEnd}
                style={{ opacity: isDragging ? 0.5 : 1 }}
              >
                {/* Drag handle */}
                <span className="drag-handle text-gray-400 px-1 text-xs opacity-0 group-hover:opacity-50 cursor-grab active:cursor-grabbing transition-opacity">
                  &#8801;
                </span>

                {/* Conversation button */}
                <button
                  onClick={() => onSelectConvo(convo.id)}
                  className={`flex-1 text-left px-2 py-2 text-sm rounded-lg truncate transition ${
                    isActive
                      ? "bg-gray-200 dark:bg-gray-800 font-medium text-gray-900 dark:text-gray-100"
                      : "text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800"
                  }`}
                  title={convo.summary || convo.id}
                >
                  {(convo.summary || convo.id || "Untitled").slice(0, 28)}
                </button>

                {/* Delete button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteConvo(convo.id);
                  }}
                  className="hidden group-hover:block px-1.5 py-1 text-gray-400 hover:text-red-500 text-xs flex-shrink-0 transition"
                  title="Delete"
                >
                  &times;
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom section */}
      <div className="p-3 border-t border-gray-200 dark:border-gray-800 space-y-2">
        {/* Health indicator */}
        <div
          className="flex items-center gap-2 text-xs text-gray-500"
          role="status"
        >
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full ${
              healthStatus?.ok ? "bg-green-500" : "bg-red-500"
            }`}
          />
          <span>{healthStatus?.text ?? "Checking..."}</span>
        </div>

        {/* Auth info */}
        {authUser && (
          <div className="text-xs text-gray-500 truncate">
            User: {authUser}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-1 text-xs flex-wrap">
          <button
            onClick={onOpenDashboard}
            className="px-2 py-1 hover:bg-gray-200 dark:hover:bg-gray-800 rounded text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 transition"
          >
            Dashboard
          </button>
          <button
            onClick={onOpenSettings}
            className="px-2 py-1 hover:bg-gray-200 dark:hover:bg-gray-800 rounded text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 transition"
          >
            Settings
          </button>
          <a
            href="/api/v1/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="px-2 py-1 hover:bg-gray-200 dark:hover:bg-gray-800 rounded text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 transition"
          >
            API
          </a>
          <button
            onClick={onToggleTheme}
            className="px-2 py-1 hover:bg-gray-200 dark:hover:bg-gray-800 rounded text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 transition"
            title="Toggle theme"
          >
            &#9684;
          </button>
          <button
            onClick={onToggleLang}
            className="px-2 py-1 hover:bg-gray-200 dark:hover:bg-gray-800 rounded text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 font-mono text-[10px] transition"
            title="Language"
          >
            {(settings.lang || "en").toUpperCase()}
          </button>
        </div>
      </div>
    </div>
  );
}
