/**
 * opencode-guardclaw — GuardClaw safety plugin for OpenCode
 *
 * Hooks tool.execute.before / tool.execute.after to call the GuardClaw
 * server for real-time risk scoring and blocking of dangerous tool calls.
 *
 * Install:
 *   Copy this file to ~/.config/opencode/plugins/guardclaw.ts
 *
 * Environment:
 *   GUARDCLAW_PORT  — GuardClaw server port (default 3002)
 */

import type { Plugin } from "@opencode-ai/plugin";

const GUARDCLAW_PORT = process.env.GUARDCLAW_PORT || "3002";
const GUARDCLAW_URL = `http://127.0.0.1:${GUARDCLAW_PORT}`;

// Store pre-tool verdicts keyed by callID, so after hook can inject them
const verdictCache = new Map<string, string>();

const GuardClawPlugin: Plugin = async ({ project }) => {
  // Test connection on startup
  try {
    await fetch(`${GUARDCLAW_URL}/api/health`);
    console.log("[GuardClaw] Connected to GuardClaw server");
  } catch {
    console.log("[GuardClaw] Server not reachable, running in monitor-only mode");
  }

  return {
    "tool.execute.before": async (input, output) => {
      try {
        const res = await fetch(
          `${GUARDCLAW_URL}/api/hooks/opencode/pre-tool-use`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tool_name: input.tool,
              tool_input: output.args || {},
              session_id: input.sessionID || project?.id || "default",
            }),
          }
        );
        if (!res.ok) return; // fail-open
        const data = (await res.json()) as {
          decision?: string;
          reason?: string;
          message?: string;
        };
        if (data.decision === "deny" || data.decision === "block") {
          throw new Error(
            data.reason || `\u26E8 GuardClaw blocked: ${input.tool}`
          );
        }
        // For bash: inject verdict into command itself so TUI renders it
        if (input.tool === "bash" && data.reason && output.args?.command) {
          const score = parseInt(String(data.reason.match(/score (\d+)/)?.[1] || "0"));
          const level = score >= 9 ? "BLOCK" : score >= 7 ? "WARN" : score >= 4 ? "CAUTION" : "ALLOW";
          const color = score >= 7 ? "31" : score >= 4 ? "33" : "90"; // red / yellow / gray
          output.args.command = `printf '\\033[${color}m⛨ GuardClaw ${level} (score ${score})\\033[0m\\n'; ${output.args.command}`;
        }
        // Cache message (verdict or security brief) for after-hook injection into agent context
        if (data.message) {
          verdictCache.set(input.callID, data.message);
          setTimeout(() => verdictCache.delete(input.callID), 60000);
        }
        // Alert for risky operations — macOS notification
        const score = parseInt(String(data.reason?.match(/score (\d+)/)?.[1] || "0"));
        if (score >= 7) {
          const level = score >= 9 ? "HIGH RISK" : "WARNING";
          const msg = (data.message || input.tool).replace(/"/g, '\\"');
          const { exec } = await import("child_process");
          exec(`osascript -e 'display notification "${msg}" with title "⛨ GuardClaw ${level} (score ${score})" sound name "Basso"'`);
        }
      } catch (e: unknown) {
        const err = e as Error;
        if (err.message?.startsWith("\u26E8")) throw e; // re-throw GuardClaw blocks
        // else fail-open silently (server unreachable, network error, etc.)
      }
    },

    "tool.execute.after": async (input, output) => {
      try {
        // Inject GuardClaw verdict — try all mutation paths
        const verdict = verdictCache.get(input.callID);
        if (verdict) {
          verdictCache.delete(input.callID);
          output.output = `${output.output || ""}\n\u26E8 ${verdict}`;
          output.title = `${output.title || input.tool} \u26E8 ${verdict}`;
          output.metadata = { ...(output.metadata || {}), guardclaw: verdict };
        }

        fetch(`${GUARDCLAW_URL}/api/hooks/opencode/post-tool-use`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tool_name: input.tool,
            tool_input: input.args || {},
            tool_output: (output.output || "").slice(0, 10000),
            session_id: input.sessionID || project?.id || "default",
          }),
        }).catch(() => {}); // swallow errors
      } catch {
        // fail-open
      }
    },

    "chat.message": async (input: any, output: any) => {
      try {
        const parts = output?.parts || [];
        const userText = parts
          .filter((p: any) => p?.type === "text" && p?.text)
          .map((p: any) => p.text)
          .join("\n");
        fetch(`${GUARDCLAW_URL}/api/hooks/opencode/message`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: input?.sessionID || project?.id || "default",
            agent: input?.agent || "default",
            model: input?.model || null,
            user_message: userText.slice(0, 20000),
          }),
        }).catch(() => {});
      } catch {
        // fail-open
      }
    },
  };
};

export default GuardClawPlugin;
