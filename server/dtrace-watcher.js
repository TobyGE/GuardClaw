/**
 * dtrace-watcher.js — Runtime network monitor for MCP server processes.
 *
 * Watches MCP server child processes for unexpected outbound network connections
 * using lsof. No sudo or special permissions required.
 *
 * SIP (System Integrity Protection) blocks dtrace's syscall provider on macOS,
 * so we use lsof for network monitoring — the most critical signal for data
 * exfiltration detection. File access monitoring requires dtrace (SIP off) and
 * is available as an optional enhancement.
 */

import { spawn, execSync } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import os from 'os';

class DtraceWatcher extends EventEmitter {
  constructor() {
    super();
    // pid → { name, command, parentApp, logs: [], startTime }
    this.watched = new Map();
    // MCP server name → { pid, command, parentApp }
    this.mcpServers = new Map();
    this.mode = 'lsof';    // 'lsof' (default) | 'dtrace' (SIP off) | 'off'
    this.available = true;  // lsof is always available
    this.scanInterval = null;
    this.lsofInterval = null;
    // pid → Set<"ip:port"> (baseline network connections)
    this.lsofBaseline = new Map();
  }

  // ─── Initialize ───────────────────────────────────────────────────────────

  async init() {
    // Check if dtrace syscall provider is available (only when SIP is off)
    let dtraceAvailable = false;
    try {
      const out = execSync('sudo -n /usr/sbin/dtrace -l -n "syscall::connect:entry" 2>/dev/null', { encoding: 'utf8', timeout: 5000 });
      // dtrace -l exits 0 even under SIP but returns only the header line (no probes)
      // A valid result has at least 2 lines: header + one or more probe entries
      const lines = out.trim().split('\n').filter(Boolean);
      dtraceAvailable = lines.length >= 2;
    } catch {}

    if (dtraceAvailable) {
      this.mode = 'dtrace';
      console.log('[DtraceWatcher] ✅ dtrace syscall provider available (SIP off) — full tracing');
    } else {
      this.mode = 'lsof';
      console.log('[DtraceWatcher] 📡 Using lsof network monitoring (SIP on — this is normal)');
    }

    // Discover existing MCP server processes
    await this.discoverMCPServers();

    // Periodically re-scan for new MCP server processes (every 30s)
    this.scanInterval = setInterval(() => this.discoverMCPServers(), 30_000);

    // Start lsof polling (every 3s)
    this.lsofInterval = setInterval(() => this._lsofPoll(), 3_000);
  }

  // ─── lsof: poll network connections for all watched processes ─────────────

  _lsofPoll() {
    for (const [name, info] of this.mcpServers) {
      try {
        // -a = AND conditions, -i = network files, -n = no DNS, -P = no port names
        const output = execSync(
          `lsof -a -i -n -P -p ${info.pid} 2>/dev/null`,
          { encoding: 'utf8', timeout: 5000 }
        ).trim();

        if (!output) continue;

        const connections = new Set();
        for (const line of output.split('\n').slice(1)) {
          // Parse: node 1234 user 5u IPv4 ... TCP 192.168.1.1:3000->52.14.1.1:443 (ESTABLISHED)
          const match = line.match(/->([\d.]+:\d+)/);
          if (match) connections.add(match[1]);
        }

        // Compare with baseline
        const baseline = this.lsofBaseline.get(info.pid) || new Set();
        for (const conn of connections) {
          if (!baseline.has(conn)) {
            // New outbound connection detected
            const logLine = `CONNECT pid=${info.pid} dest=${conn}`;

            // Add to logs
            const entry = this.watched.get(info.pid);
            if (entry) {
              entry.logs.push({ time: Date.now(), raw: logLine });
              if (entry.logs.length > 1000) entry.logs.shift();
            }

            // Check if this is to localhost (less suspicious) or external
            const isLocal = conn.startsWith('127.') || conn.startsWith('[::1]');
            const severity = isLocal ? 'info' : 'warning';

            if (!isLocal) {
              const alert = {
                type: 'network-connect',
                severity,
                mcpName: name,
                pid: info.pid,
                parentApp: info.parentApp,
                detail: `MCP server "${name}" connected to ${conn}`,
                syscall: logLine,
                timestamp: Date.now(),
              };
              console.log(`[DtraceWatcher] 🚨 External connection: ${name} (PID ${info.pid}) → ${conn}`);
              this.emit('alert', alert);
            }
          }
        }

        // Update baseline
        this.lsofBaseline.set(info.pid, connections);
      } catch {
        // Process may have exited — ignore
      }
    }
  }

  // ─── Discover MCP server processes ────────────────────────────────────────

  async discoverMCPServers() {
    try {
      const psOutput = execSync(
        'ps -eo pid,ppid,command 2>/dev/null',
        { encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024 }
      ).trim();

      const lines = psOutput.split('\n').slice(1);
      const processes = lines.map(line => {
        const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
        if (!match) return null;
        return { pid: parseInt(match[1]), ppid: parseInt(match[2]), command: match[3] };
      }).filter(Boolean);

      // Find agent parent processes
      const agentParents = new Map();
      for (const p of processes) {
        if (/Claude\.app|claude-desktop/i.test(p.command)) agentParents.set(p.pid, 'Claude Desktop');
        if (/\/claude\b/.test(p.command) && !/Claude\.app/.test(p.command)) agentParents.set(p.pid, 'Claude Code CLI');
        if (/gemini/i.test(p.command) && !/Gemini\.app/.test(p.command)) agentParents.set(p.pid, 'Gemini CLI');
        if (/Cursor\.app/i.test(p.command)) agentParents.set(p.pid, 'Cursor');
      }

      // Check parent and grandparent (agent → disclaimer wrapper → MCP server)
      const childOf = (pid) => {
        const parent = agentParents.get(pid);
        if (parent) return parent;
        const proc = processes.find(p => p.pid === pid);
        if (proc) return agentParents.get(proc.ppid);
        return null;
      };

      for (const p of processes) {
        const parentApp = childOf(p.ppid);
        if (!parentApp) continue;

        // Skip GuardClaw's own processes and disclaimer wrappers
        if (/guardclaw\/server\/index|guardclaw\/mcp-server\/index/i.test(p.command)) continue;
        if (/disclaimer/i.test(p.command)) continue;

        // Check if it looks like an MCP server
        const isMCPLike = /\b(node|python|npx|bun|deno)\b/i.test(p.command) &&
                          !agentParents.has(p.pid);

        if (isMCPLike) {
          const name = this._extractMCPName(p.command);
          const existing = this.mcpServers.get(name);

          if (!existing || existing.pid !== p.pid) {
            this.mcpServers.set(name, { pid: p.pid, command: p.command, parentApp });

            if (!this.watched.has(p.pid)) {
              this.watched.set(p.pid, {
                name,
                command: p.command,
                parentApp,
                logs: [],
                startTime: Date.now(),
              });

              // If dtrace is available, also start syscall tracing
              if (this.mode === 'dtrace') {
                this._startDtrace(p.pid, name);
              }

              console.log(`[DtraceWatcher] 📡 Monitoring MCP server: ${name} (PID ${p.pid}, via ${parentApp})`);
            }
          }
        }
      }

      // Clean up dead processes
      for (const [name, info] of this.mcpServers) {
        try {
          process.kill(info.pid, 0);
        } catch {
          console.log(`[DtraceWatcher] 🔴 MCP server exited: ${name} (PID ${info.pid})`);
          this.watched.delete(info.pid);
          this.lsofBaseline.delete(info.pid);
          this.mcpServers.delete(name);
        }
      }
    } catch (err) {
      console.error('[DtraceWatcher] Process scan error:', err.message);
    }
  }

  // ─── Optional dtrace tracing (only works with SIP off) ───────────────────

  _startDtrace(pid, name) {
    const dtraceScript = `
      syscall::connect:entry /pid == ${pid} || ppid == ${pid}/ {
        printf("CONNECT pid=%d", pid);
      }
      syscall::open:entry /pid == ${pid} || ppid == ${pid}/ {
        printf("OPEN pid=%d path=%s", pid, copyinstr(arg0));
      }
      syscall::open_nocancel:entry /pid == ${pid} || ppid == ${pid}/ {
        printf("OPEN pid=%d path=%s", pid, copyinstr(arg0));
      }
      syscall::execve:entry /pid == ${pid} || ppid == ${pid}/ {
        printf("EXEC pid=%d path=%s", pid, copyinstr(arg0));
      }
    `;

    try {
      const dtrace = spawn('sudo', ['/usr/sbin/dtrace', '-q', '-n', dtraceScript], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const entry = this.watched.get(pid);
      if (entry) entry._dtraceProcess = dtrace;

      dtrace.stdout.on('data', (buf) => {
        const lines = buf.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          if (entry) {
            entry.logs.push({ time: Date.now(), raw: line.trim() });
            if (entry.logs.length > 1000) entry.logs.shift();
          }

          const alert = this._checkDtraceLine(line.trim(), name, pid, entry?.parentApp);
          if (alert) this.emit('alert', alert);
        }
      });

      dtrace.on('exit', () => { if (entry) entry._dtraceProcess = null; });
      console.log(`[DtraceWatcher] 🔬 dtrace attached to ${name} (PID ${pid})`);
    } catch (err) {
      console.error(`[DtraceWatcher] Failed to start dtrace for ${name}: ${err.message}`);
    }
  }

  // ─── Sensitive path patterns for dtrace mode ──────────────────────────────

  _checkDtraceLine(line, mcpName, pid, parentApp) {
    const SENSITIVE_PATHS = [
      /\.ssh\//i, /\.aws\//i, /\.gnupg\//i, /\.env$/i, /\.env\./i,
      /\.pem$/i, /\.key$/i, /\.keystore$/i, /credentials/i,
      /secret/i, /token/i, /\.claude\/settings/i, /\.gemini\/settings/i,
    ];
    const SUSPICIOUS_EXEC = [
      /\bcurl\b/, /\bwget\b/, /\bnc\b/, /\bncat\b/, /\bnetcat\b/,
      /\bssh\b/, /\bscp\b/, /\bbase64\b/, /\bopenssl\b/,
    ];

    if (line.startsWith('OPEN')) {
      const pathMatch = line.match(/path=(.+)/);
      if (pathMatch) {
        for (const pattern of SENSITIVE_PATHS) {
          if (pattern.test(pathMatch[1])) {
            return {
              type: 'sensitive-file-access',
              severity: 'high',
              mcpName, pid, parentApp,
              detail: `MCP server "${mcpName}" read sensitive file: ${pathMatch[1]}`,
              syscall: line,
              timestamp: Date.now(),
            };
          }
        }
      }
    }

    if (line.startsWith('EXEC')) {
      const pathMatch = line.match(/path=(.+)/);
      if (pathMatch) {
        for (const pattern of SUSPICIOUS_EXEC) {
          if (pattern.test(pathMatch[1])) {
            return {
              type: 'suspicious-exec',
              severity: 'high',
              mcpName, pid, parentApp,
              detail: `MCP server "${mcpName}" spawned suspicious process: ${pathMatch[1]}`,
              syscall: line,
              timestamp: Date.now(),
            };
          }
        }
      }
    }

    return null;
  }

  // ─── Get syscall/network log for a specific MCP server ────────────────────

  getSyscallLog(mcpName, since = 0) {
    const server = this.mcpServers.get(mcpName);
    if (!server) return null;

    const entry = this.watched.get(server.pid);
    if (!entry) return null;

    const logs = since ? entry.logs.filter(l => l.time >= since) : entry.logs;

    return {
      mcpName,
      pid: server.pid,
      command: server.command,
      parentApp: server.parentApp,
      logCount: logs.length,
      logs: logs.map(l => l.raw),
    };
  }

  getAllSyscallLogs(since = 0) {
    const result = [];
    for (const [name] of this.mcpServers) {
      const log = this.getSyscallLog(name, since);
      if (log && log.logCount > 0) result.push(log);
    }
    return result;
  }

  // ─── Get status for dashboard ─────────────────────────────────────────────

  getStatus() {
    return {
      available: true,
      mode: this.mode,
      watchedCount: this.watched.size,
      mcpServers: Array.from(this.mcpServers.entries()).map(([name, info]) => ({
        name,
        pid: info.pid,
        parentApp: info.parentApp,
        command: info.command.slice(0, 120),
        logCount: this.watched.get(info.pid)?.logs.length || 0,
      })),
    };
  }

  // ─── Extract a readable MCP server name from command ──────────────────────

  _extractMCPName(command) {
    const nodeMatch = command.match(/node\s+.*\/([^/]+?)(?:\/index\.\w+)?(?:\s|$)/);
    if (nodeMatch) return nodeMatch[1];

    const pyModMatch = command.match(/python.*-m\s+(\S+)/);
    if (pyModMatch) return pyModMatch[1];

    const npxMatch = command.match(/npx\s+(\S+)/);
    if (npxMatch) return npxMatch[1];

    const parts = command.split(/\s+/);
    const scriptPath = parts.find(p => p.includes('/') && !p.startsWith('-'));
    if (scriptPath) return path.basename(scriptPath, path.extname(scriptPath));

    return command.slice(0, 40);
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────────

  shutdown() {
    if (this.scanInterval) clearInterval(this.scanInterval);
    if (this.lsofInterval) clearInterval(this.lsofInterval);
    for (const [pid, entry] of this.watched) {
      if (entry._dtraceProcess) {
        try { entry._dtraceProcess.kill('SIGTERM'); } catch {}
      }
    }
    this.watched.clear();
    this.mcpServers.clear();
    this.mode = 'off';
    console.log('[DtraceWatcher] Shut down');
  }
}

export const dtraceWatcher = new DtraceWatcher();
