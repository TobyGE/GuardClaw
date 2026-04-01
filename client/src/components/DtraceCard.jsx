export default function DtraceCard({ status }) {
  if (!status) return null;

  const isDtrace = status.mode === 'dtrace';
  const isLsof = status.mode === 'lsof';
  const serverCount = status.mcpServers?.length || 0;

  return (
    <div className="mb-6 bg-gc-card rounded-lg border border-gc-border p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">{isDtrace ? '🔬' : '👁️'}</span>
          <span className="text-sm font-semibold text-gc-text">
            MCP Runtime Monitor
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            isDtrace
              ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
              : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
          }`}>
            {isDtrace ? 'dtrace (full)' : 'network monitoring'}
          </span>
        </div>
        <span className="text-xs text-gc-text-dim">
          {serverCount} MCP server{serverCount !== 1 ? 's' : ''}
        </span>
      </div>

      {serverCount > 0 ? (
        <div className="space-y-1.5">
          {status.mcpServers.map((s, i) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span className="text-gc-text font-mono">{s.name}</span>
                <span className="text-gc-text-dim">PID {s.pid}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-gc-text-dim">{s.parentApp}</span>
                {s.logCount > 0 && (
                  <span className="text-amber-500 font-medium">{s.logCount} alerts</span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-xs text-gc-text-dim">
          No MCP server processes detected. They will appear here when an agent launches an MCP tool.
        </div>
      )}
    </div>
  );
}
