import { execFileNoThrow } from "../utils/execFileNoThrow";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { logModuleError } from "../core/module-logger";

export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const IMAGES: Record<string, string> = {
  javascript: "node:22-slim",
  python: "python:3.12-slim",
  shell: "alpine:3.20"
};

const INTERPRETERS: Record<string, string> = {
  javascript: "node",
  python: "python3",
  shell: "sh"
};

const EXTENSIONS: Record<string, string> = {
  javascript: "mjs",
  python: "py",
  shell: "sh"
};

const RUN_FILES: Record<string, string> = {
  javascript: "run.mjs",
  python: "run.py",
  shell: "run.sh"
};

let _dockerAvailable: boolean | undefined;

/**
 * Checks whether Docker is available on the host by running `docker info`.
 * Result is memoized after the first call.
 */
export async function isDockerAvailable(): Promise<boolean> {
  if (_dockerAvailable !== undefined) return _dockerAvailable;
  const result = await execFileNoThrow("docker", ["info"], { timeoutMs: 5000 });
  _dockerAvailable = result.status === 0;
  return _dockerAvailable;
}

/**
 * Reset the cached docker-availability flag (useful in tests).
 */
export function _resetDockerCache(): void {
  _dockerAvailable = undefined;
}

/**
 * Execute code inside a Docker container with resource limits.
 */
export async function runInDocker(opts: {
  language: "javascript" | "python" | "shell";
  code: string;
  timeoutMs?: number;
  memoryMb?: number;
  cpus?: number;
  networkEnabled?: boolean;
}): Promise<SandboxResult> {
  const {
    language,
    code,
    timeoutMs = 10_000,
    memoryMb = 256,
    cpus = 0.5,
    networkEnabled = false
  } = opts;

  const image = IMAGES[language];
  const interpreter = INTERPRETERS[language];
  const ext = EXTENSIONS[language];
  const runFile = RUN_FILES[language];

  if (!image) {
    throw new Error(`docker-runner: unsupported language "${language}"`);
  }

  // Write code to a temp file on the host
  const tmpDir = join(tmpdir(), "agent-docker-code");
  mkdirSync(tmpDir, { recursive: true });
  const filename = `${randomBytes(8).toString("hex")}.${ext}`;
  const hostPath = join(tmpDir, filename);
  writeFileSync(hostPath, code, "utf8");

  const containerPath = `/code/${runFile}`;

  const dockerArgs: string[] = [
    "run",
    "--rm",
    `--memory=${memoryMb}m`,
    `--cpus=${cpus}`,
    ...(networkEnabled ? [] : ["--network=none"]),
    "-v",
    `${hostPath}:${containerPath}:ro`,
    "-w",
    "/code",
    image,
    interpreter,
    runFile
  ];

  try {
    const result = await execFileNoThrow("docker", dockerArgs, { timeoutMs });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.status
    };
  } finally {
    try {
      unlinkSync(hostPath);
    } catch (error) {
      logModuleError("docker-runner", "optional", error, "cleaning up temp code file");
    }
  }
}
