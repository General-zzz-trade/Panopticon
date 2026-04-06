import * as net from "node:net";
import * as tls from "node:tls";
import type { AgentTask, RunContext } from "../types";
import type { TaskExecutionOutput } from "./browser-handler";
import { registerTool } from "../tools/registry";

export interface EmailConfig {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  useTLS: boolean;
}

/**
 * Read email config from environment variables.
 */
function readConfigFromEnv(): EmailConfig {
  return {
    smtpHost: process.env.EMAIL_SMTP_HOST ?? "",
    smtpPort: parseInt(process.env.EMAIL_SMTP_PORT ?? "465", 10),
    smtpUser: process.env.EMAIL_SMTP_USER ?? "",
    smtpPass: process.env.EMAIL_SMTP_PASS ?? "",
    useTLS: process.env.EMAIL_USE_TLS !== "false",
  };
}

/**
 * Returns true if EMAIL_SMTP_HOST and EMAIL_SMTP_USER are set.
 */
export function isEmailConfigured(): boolean {
  return !!(process.env.EMAIL_SMTP_HOST && process.env.EMAIL_SMTP_USER);
}

/**
 * Handle send_email and read_email agent tasks.
 */
export async function handleEmailTask(
  context: RunContext,
  task: AgentTask
): Promise<TaskExecutionOutput> {
  if (task.type === "send_email") {
    const { to, subject, body, cc, bcc } = task.payload as Record<string, string | undefined>;
    if (!to) throw new Error("send_email requires 'to' in payload");
    if (!subject) throw new Error("send_email requires 'subject' in payload");
    if (!body) throw new Error("send_email requires 'body' in payload");

    if (!isEmailConfigured()) {
      throw new Error(
        "Email not configured. Set EMAIL_SMTP_HOST and EMAIL_SMTP_USER environment variables."
      );
    }

    const config = readConfigFromEnv();
    const result = await sendEmail(config, to, subject, body, cc, bcc);

    return {
      summary: result.success
        ? `Email sent to ${to}: ${result.message}`
        : `Email failed: ${result.message}`,
      stateHints: [result.success ? "email_sent" : "email_failed"],
    };
  }

  if (task.type === "read_email") {
    const folder = (task.payload.folder as string) ?? "INBOX";
    const count = (task.payload.count as number) ?? 10;
    return {
      summary: `read_email is not yet implemented. Would read ${count} messages from "${folder}".`,
      stateHints: ["email_read_not_implemented"],
    };
  }

  throw new Error(`Unknown email task type: ${task.type}`);
}

/**
 * Read a full SMTP response (may span multiple lines).
 * Lines starting with "XXX-" are continuations; "XXX " is the final line.
 */
function readSmtpResponse(socket: net.Socket | tls.TLSSocket, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("SMTP response timeout"));
    }, timeoutMs);

    function onData(chunk: Buffer): void {
      data += chunk.toString("utf8");
      // A complete SMTP response ends with "XXX <text>\r\n"
      const lines = data.split("\r\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Final line of response: status code followed by a space
        if (line.length >= 4 && line[3] === " ") {
          cleanup();
          resolve(data.trimEnd());
          return;
        }
      }
    }

    function onError(err: Error): void {
      cleanup();
      reject(err);
    }

    function onClose(): void {
      cleanup();
      if (data.length > 0) {
        resolve(data.trimEnd());
      } else {
        reject(new Error("SMTP connection closed unexpectedly"));
      }
    }

    function cleanup(): void {
      clearTimeout(timer);
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
      socket.removeListener("close", onClose);
    }

    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("close", onClose);
  });
}

/**
 * Send an SMTP command and wait for a response.
 */
function smtpCommand(
  socket: net.Socket | tls.TLSSocket,
  command: string,
  timeoutMs: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    socket.write(command + "\r\n", (err) => {
      if (err) {
        reject(err);
        return;
      }
      readSmtpResponse(socket, timeoutMs).then(resolve, reject);
    });
  });
}

/**
 * Assert that the SMTP response starts with one of the expected status codes.
 */
function assertSmtpCode(response: string, ...expectedCodes: string[]): void {
  const code = response.substring(0, 3);
  if (!expectedCodes.includes(code)) {
    throw new Error(`Unexpected SMTP response: ${response} (expected ${expectedCodes.join("/")})`);
  }
}

/**
 * Build a raw MIME message.
 */
function buildMimeMessage(
  from: string,
  to: string,
  subject: string,
  body: string,
  cc?: string,
  bcc?: string
): string {
  const date = new Date().toUTCString();
  const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@panopticon>`;

  let headers = `From: ${from}\r\n`;
  headers += `To: ${to}\r\n`;
  if (cc) headers += `Cc: ${cc}\r\n`;
  // BCC intentionally not added to headers (but used for RCPT TO)
  headers += `Subject: ${subject}\r\n`;
  headers += `Date: ${date}\r\n`;
  headers += `Message-ID: ${messageId}\r\n`;
  headers += `MIME-Version: 1.0\r\n`;
  headers += `Content-Type: text/plain; charset=utf-8\r\n`;
  headers += `Content-Transfer-Encoding: 7bit\r\n`;

  return headers + "\r\n" + body;
}

/**
 * Connect to an SMTP server and send an email using the SMTP protocol.
 *
 * State machine:
 *   1. Connect -> read greeting
 *   2. EHLO -> read response
 *   3. AUTH LOGIN -> send base64 user -> send base64 pass
 *   4. MAIL FROM
 *   5. RCPT TO (for each recipient)
 *   6. DATA -> send headers + body + "."
 *   7. QUIT
 */
export async function sendEmail(
  config: EmailConfig,
  to: string,
  subject: string,
  body: string,
  cc?: string,
  bcc?: string
): Promise<{ success: boolean; message: string }> {
  const TIMEOUT = 15_000;
  let socket: net.Socket | tls.TLSSocket | undefined;

  try {
    // 1. Connect
    socket = await new Promise<net.Socket | tls.TLSSocket>((resolve, reject) => {
      const onError = (err: Error): void => reject(err);

      if (config.useTLS) {
        const s = tls.connect(
          { host: config.smtpHost, port: config.smtpPort, rejectUnauthorized: true },
          () => {
            s.removeListener("error", onError);
            resolve(s);
          }
        );
        s.on("error", onError);
      } else {
        const s = net.createConnection(
          { host: config.smtpHost, port: config.smtpPort },
          () => {
            s.removeListener("error", onError);
            resolve(s);
          }
        );
        s.on("error", onError);
      }
    });

    // Read greeting
    const greeting = await readSmtpResponse(socket, TIMEOUT);
    assertSmtpCode(greeting, "220");

    // 2. EHLO
    const ehloResp = await smtpCommand(socket, `EHLO panopticon`, TIMEOUT);
    assertSmtpCode(ehloResp, "250");

    // 3. AUTH LOGIN
    if (config.smtpUser && config.smtpPass) {
      const authResp = await smtpCommand(socket, "AUTH LOGIN", TIMEOUT);
      assertSmtpCode(authResp, "334");

      const userResp = await smtpCommand(
        socket,
        Buffer.from(config.smtpUser).toString("base64"),
        TIMEOUT
      );
      assertSmtpCode(userResp, "334");

      const passResp = await smtpCommand(
        socket,
        Buffer.from(config.smtpPass).toString("base64"),
        TIMEOUT
      );
      assertSmtpCode(passResp, "235");
    }

    // 4. MAIL FROM
    const fromAddr = config.smtpUser;
    const mailFromResp = await smtpCommand(socket, `MAIL FROM:<${fromAddr}>`, TIMEOUT);
    assertSmtpCode(mailFromResp, "250");

    // 5. RCPT TO — collect all recipients
    const recipients: string[] = [to];
    if (cc) {
      recipients.push(...cc.split(",").map((s) => s.trim()));
    }
    if (bcc) {
      recipients.push(...bcc.split(",").map((s) => s.trim()));
    }

    for (const rcpt of recipients) {
      if (!rcpt) continue;
      const rcptResp = await smtpCommand(socket, `RCPT TO:<${rcpt}>`, TIMEOUT);
      assertSmtpCode(rcptResp, "250", "251");
    }

    // 6. DATA
    const dataResp = await smtpCommand(socket, "DATA", TIMEOUT);
    assertSmtpCode(dataResp, "354");

    const mime = buildMimeMessage(fromAddr, to, subject, body, cc, bcc);
    // Dot-stuff the body: any line starting with "." gets an extra "."
    const dotStuffed = mime.replace(/\r\n\./g, "\r\n..");
    const endResp = await smtpCommand(socket, dotStuffed + "\r\n.", TIMEOUT);
    assertSmtpCode(endResp, "250");

    // 7. QUIT
    try {
      await smtpCommand(socket, "QUIT", 5_000);
    } catch {
      // QUIT failure is non-fatal; message was already accepted
    }

    socket.destroy();

    return { success: true, message: `Delivered to ${to}` };
  } catch (err: unknown) {
    if (socket) {
      try {
        socket.destroy();
      } catch {
        // ignore cleanup errors
      }
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: msg };
  }
}

// Auto-register on import
registerTool({
  name: "send_email",
  category: "custom",
  description: "Send an email",
  parameters: [
    { name: "to", type: "string", required: true, description: "Recipient email" },
    { name: "subject", type: "string", required: true, description: "Email subject" },
    { name: "body", type: "string", required: true, description: "Email body" },
  ],
  verificationStrategy: "error",
  mutating: true,
  requiresApproval: true,
});
