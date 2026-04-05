/**
 * Environment Watcher — monitors external signals and triggers autonomous goals.
 *
 * Watchers detect events (file changes, HTTP state, scheduled time, etc.)
 * and emit trigger events. The goal synthesizer turns triggers into goals.
 * The autonomous loop runs those goals without human input.
 */

import * as fs from "fs";
import { logModuleError } from "../core/module-logger";

export interface Trigger {
  type: string;
  source: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface WatcherConfig {
  name: string;
  /** Check interval in milliseconds */
  intervalMs: number;
  /** Function that checks for trigger condition, returns Trigger or null */
  check: () => Promise<Trigger | null> | Trigger | null;
}

const watchers = new Map<string, ReturnType<typeof setInterval>>();
const triggerListeners: Array<(trigger: Trigger) => void> = [];

/**
 * Register a watcher that checks for triggers periodically.
 */
export function registerWatcher(config: WatcherConfig): void {
  if (watchers.has(config.name)) {
    stopWatcher(config.name);
  }

  const timer = setInterval(async () => {
    try {
      const trigger = await config.check();
      if (trigger) {
        for (const listener of triggerListeners) {
          try { listener(trigger); } catch (err) {
            logModuleError("watcher", "optional", err, `listener for ${config.name}`);
          }
        }
      }
    } catch (err) {
      logModuleError("watcher", "optional", err, `watcher ${config.name} check failed`);
    }
  }, config.intervalMs);

  watchers.set(config.name, timer);
}

export function stopWatcher(name: string): void {
  const timer = watchers.get(name);
  if (timer) {
    clearInterval(timer);
    watchers.delete(name);
  }
}

export function stopAllWatchers(): void {
  for (const name of watchers.keys()) stopWatcher(name);
}

export function listWatchers(): string[] {
  return Array.from(watchers.keys());
}

export function onTrigger(listener: (trigger: Trigger) => void): void {
  triggerListeners.push(listener);
}

// ── Built-in watcher factories ──────────────────────────────────────────

/**
 * Watch a file for changes (mtime).
 */
export function createFileWatcher(name: string, filePath: string, intervalMs = 5000): WatcherConfig {
  let lastMtime = 0;
  return {
    name,
    intervalMs,
    check: () => {
      try {
        if (!fs.existsSync(filePath)) return null;
        const stat = fs.statSync(filePath);
        const mtime = stat.mtimeMs;
        if (lastMtime === 0) {
          lastMtime = mtime;
          return null;
        }
        if (mtime !== lastMtime) {
          const oldMtime = lastMtime;
          lastMtime = mtime;
          return {
            type: "file_changed",
            source: name,
            timestamp: new Date().toISOString(),
            data: { path: filePath, previousMtime: oldMtime, currentMtime: mtime }
          };
        }
        return null;
      } catch {
        return null;
      }
    }
  };
}

/**
 * Watch an HTTP endpoint for changes (content hash or status).
 */
export function createHttpWatcher(name: string, url: string, intervalMs = 60000): WatcherConfig {
  let lastHash = "";
  let lastStatus = 0;
  return {
    name,
    intervalMs,
    check: async () => {
      try {
        const res = await fetch(url);
        const body = await res.text();
        const hash = simpleHash(body);

        const statusChanged = lastStatus !== 0 && lastStatus !== res.status;
        const contentChanged = lastHash !== "" && lastHash !== hash;

        lastStatus = res.status;
        lastHash = hash;

        if (statusChanged || contentChanged) {
          return {
            type: statusChanged ? "http_status_changed" : "http_content_changed",
            source: name,
            timestamp: new Date().toISOString(),
            data: { url, status: res.status, hashChanged: contentChanged }
          };
        }
        return null;
      } catch (err) {
        return null;
      }
    }
  };
}

/**
 * Watch a directory for new files.
 */
export function createDirectoryWatcher(name: string, dirPath: string, intervalMs = 5000): WatcherConfig {
  let knownFiles: Set<string> | null = null;  // null = not yet initialized
  return {
    name,
    intervalMs,
    check: () => {
      try {
        if (!fs.existsSync(dirPath)) return null;
        const files = fs.readdirSync(dirPath);
        if (knownFiles === null) {
          knownFiles = new Set(files);
          return null;
        }
        const prev: Set<string> = knownFiles;
        const newFiles = files.filter(f => !prev.has(f));
        if (newFiles.length > 0) {
          knownFiles = new Set(files);
          return {
            type: "new_files",
            source: name,
            timestamp: new Date().toISOString(),
            data: { path: dirPath, files: newFiles }
          };
        }
        knownFiles = new Set(files);
        return null;
      } catch {
        return null;
      }
    }
  };
}

function simpleHash(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(36);
}
