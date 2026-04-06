/**
 * Shell Session — persistent interactive shell for OSINT operations.
 *
 * Maintains a live bash process across multiple commands.
 * Supports: cd, environment variables, pipes, reading output,
 * and using previous output to decide the next command.
 */

import { spawn, type ChildProcess } from "child_process";
import { logModuleError } from "../core/module-logger";

export interface ShellSession {
  id: string;
  process: ChildProcess;
  cwd: string;
  alive: boolean;
}

export interface ShellCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

const sessions = new Map<string, ShellSession>();

/**
 * Create a new persistent shell session.
 */
export function createShellSession(id?: string, cwd?: string): ShellSession {
  const sessionId = id ?? `shell-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const proc = spawn("bash", ["--norc", "--noprofile", "-i"], {
    cwd: cwd ?? process.cwd(),
    env: { ...process.env, TERM: "dumb", PS1: "" },
    stdio: ["pipe", "pipe", "pipe"]
  });

  const session: ShellSession = {
    id: sessionId,
    process: proc,
    cwd: cwd ?? process.cwd(),
    alive: true
  };

  proc.on("exit", () => { session.alive = false; });
  proc.on("error", (err) => {
    logModuleError("shell-session", "critical", err, `shell process error for ${sessionId}`);
    session.alive = false;
  });

  sessions.set(sessionId, session);
  return session;
}

/**
 * Run a command in the persistent shell session.
 * Returns stdout, stderr, and exit code.
 */
export function runCommand(
  session: ShellSession,
  command: string,
  timeoutMs: number = 30000
): Promise<ShellCommandResult> {
  return new Promise((resolve) => {
    if (!session.alive || !session.process.stdin?.writable) {
      resolve({ stdout: "", stderr: "Shell session is not alive", exitCode: 1, timedOut: false });
      return;
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    // Use a unique marker to detect when command output is complete
    const marker = `__SHELL_DONE_${Date.now()}_${Math.random().toString(36).slice(2, 8)}__`;
    const exitCodeMarker = `__EXIT_${marker}__`;

    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;

      // Check if we've received the end marker
      if (stdout.includes(exitCodeMarker)) {
        cleanup();
        // Extract exit code from marker
        const exitMatch = stdout.match(new RegExp(`${exitCodeMarker}(\\d+)`));
        const exitCode = exitMatch ? parseInt(exitMatch[1], 10) : 0;
        // Clean up markers from output
        stdout = stdout
          .replace(new RegExp(`echo ${exitCodeMarker}\\$\\?\\n?`), "")
          .replace(new RegExp(`${exitCodeMarker}\\d+\\n?`), "")
          .trim();
        resolve({ stdout, stderr, exitCode, timedOut: false });
      }
    };

    const onStderr = (chunk: Buffer) => {
      stderr += chunk.toString();
    };

    const timer = setTimeout(() => {
      timedOut = true;
      cleanup();
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: null, timedOut: true });
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      session.process.stdout?.removeListener("data", onData);
      session.process.stderr?.removeListener("data", onStderr);
    };

    session.process.stdout?.on("data", onData);
    session.process.stderr?.on("data", onStderr);

    // Send command + exit code capture + end marker
    session.process.stdin!.write(`${command}\necho ${exitCodeMarker}$?\n`);
  });
}

/**
 * Get the current working directory of the session.
 */
export async function getSessionCwd(session: ShellSession): Promise<string> {
  const result = await runCommand(session, "pwd", 5000);
  return result.stdout.trim() || session.cwd;
}

/**
 * Get an existing session or create a new one.
 */
export function getOrCreateSession(id: string, cwd?: string): ShellSession {
  const existing = sessions.get(id);
  if (existing?.alive) return existing;
  return createShellSession(id, cwd);
}

/**
 * Close a shell session.
 */
export function closeShellSession(id: string): void {
  const session = sessions.get(id);
  if (session?.alive) {
    session.process.stdin?.end();
    session.process.kill();
    session.alive = false;
  }
  sessions.delete(id);
}

/**
 * Close all sessions.
 */
export function closeAllShellSessions(): void {
  for (const id of sessions.keys()) {
    closeShellSession(id);
  }
}

/**
 * List active sessions.
 */
export function listShellSessions(): Array<{ id: string; alive: boolean; cwd: string }> {
  return Array.from(sessions.values()).map(s => ({
    id: s.id,
    alive: s.alive,
    cwd: s.cwd
  }));
}
