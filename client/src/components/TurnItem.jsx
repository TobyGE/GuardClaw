import { useState } from 'react';

const TOOL_ICONS = {
  exec: '⚡',
  read: '📖',
  write: '📝',
  edit: '✏️',
  web_fetch: '🌐',
  web_search: '🔍',
  browser: '🌐',
  message: '📨',
  memory_search: '🧠',
  memory_get: '🧠',
  image: '🖼️',
  tts: '🔊',
  canvas: '🎨',
  nodes: '📡',
  sessions_spawn: '🤖',
  sessions_send: '📤',
  sessions_list: '📋',
  sessions_history: '📜',
  session_status: '📊',
};

function toolIcon(name) {
  if (!name) return '🔧';
  return TOOL_ICONS[name] || '🔧';
}

function getRiskLevel(score) {
  if (score === undefined || score === null) return null;
  if (score <= 3) return { label: 'SAFE', color: 'text-gc-safe bg-gc-safe/20', dot: 'bg-gc-safe' };
  if (score <= 7) return { label: 'WARNING', color: 'text-gc-warning bg-gc-warning/20', dot: 'bg-gc-warning' };
  return { label: 'BLOCKED', color: 'text-gc-danger bg-gc-danger/20', dot: 'bg-gc-danger' };
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
  }
  return date.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

/* ---------- ToolCallRow: one collapsed/expanded tool call ---------- */
function ToolCallRow({ event }) {
  const [open, setOpen] = useState(false);
  const riskLevel = getRiskLevel(event.safeguard?.riskScore);
  const name = event.tool || event.subType || 'tool';
  const desc = event.command || event.description || '';

  return (
    <div className="rounded border border-gc-border bg-gc-bg/60">
      <button
        className="w-full flex items-start justify-between px-3 py-2 text-left hover:bg-gc-border/20 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center space-x-2 flex-1 min-w-0">
          <span className="text-base">{toolIcon(name)}</span>
          <span className="text-sm font-medium text-gc-text">{name}</span>
          {riskLevel && (
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${riskLevel.color}`}>
              {riskLevel.label} {event.safeguard?.riskScore}/10
            </span>
          )}
          {desc && (
            <code className="text-xs text-gc-text-dim truncate max-w-xs">
              {desc.substring(0, 80)}{desc.length > 80 ? '…' : ''}
            </code>
          )}
        </div>
        <span className="text-gc-text-dim text-xs ml-2 flex-shrink-0">{open ? '▼' : '▶'}</span>
      </button>

      {open && (
        <div className="border-t border-gc-border px-3 py-3 space-y-2">
          {/* Full description / command */}
          {desc && (
            <div>
              <span className="text-xs text-gc-text-dim">Input:</span>
              <code className="block mt-1 text-xs bg-gc-bg p-2 rounded break-words whitespace-pre-wrap max-h-48 overflow-y-auto">
                {desc}
              </code>
            </div>
          )}

          {/* streamingSteps for this specific tool-call (if any) */}
          {event.streamingSteps?.length > 0 && (
            <div>
              <span className="text-xs text-gc-text-dim">Streaming steps:</span>
              <div className="mt-1 space-y-1">
                {event.streamingSteps.map((step, i) => (
                  <div key={step.id || i} className="text-xs bg-gc-bg p-2 rounded border border-gc-border/50">
                    <span className="font-medium">{step.toolName || step.type}</span>
                    {step.content && <pre className="mt-1 text-gc-text-dim whitespace-pre-wrap">{step.content.substring(0, 300)}</pre>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Security Analysis */}
          {event.safeguard && (
            <div className="text-xs bg-gc-primary/5 border border-gc-primary/20 rounded p-2 space-y-1">
              <span className="font-medium text-gc-primary">🛡️ Security Analysis</span>
              {event.safeguard.category && <div><span className="text-gc-text-dim">Category: </span>{event.safeguard.category}</div>}
              {event.safeguard.reasoning && <div className="text-gc-text-dim italic">{event.safeguard.reasoning}</div>}
              {event.safeguard.concerns?.length > 0 && (
                <ul className="list-disc list-inside text-gc-warning">
                  {event.safeguard.concerns.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              )}
            </div>
          )}

          <div className="text-xs text-gc-text-dim">{formatTime(event.timestamp || Date.now())}</div>
        </div>
      )}
    </div>
  );
}

/* ---------- TurnItem: one agent response turn ---------- */
function TurnItem({ turn }) {
  const { parent, toolCalls } = turn;
  const [showDetails, setShowDetails] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);

  // ── Case 1: orphan tool-calls only (agent still running / no parent) ──
  if (!parent) {
    return (
      <div className="px-6 py-4 hover:bg-gc-border/10 transition-colors">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <span className="text-gc-text-dim text-sm animate-pulse">⏳</span>
            <span className="text-sm font-medium text-gc-text-dim">Agent working…</span>
            <span className="text-xs text-gc-text-dim">({toolCalls.length} tool{toolCalls.length !== 1 ? 's' : ''})</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="text-xs text-gc-text-dim">{toolCalls[0] ? formatTime(toolCalls[0].timestamp) : ''}</span>
          </div>
        </div>
        <div className="space-y-2">
          {toolCalls.map((tc, i) => <ToolCallRow key={tc.id || i} event={tc} />)}
        </div>
      </div>
    );
  }

  // ── Case 2: standalone event (no tool calls) ──
  if (toolCalls.length === 0) {
    return <StandaloneEvent event={parent} />;
  }

  // ── Case 3: chat-update/chat-message with tool calls → full turn ──
  const riskLevel = getRiskLevel(parent.safeguard?.riskScore);
  const content = parent.summary || parent.description || '';

  // Determine how many unique tool names
  const toolNames = [...new Set(toolCalls.map(tc => tc.tool || tc.subType).filter(Boolean))];

  return (
    <div className="px-6 py-4 hover:bg-gc-border/10 transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center space-x-3 mb-2">
            <span className="text-gc-text font-medium">💬 chat-message</span>
            {riskLevel && (
              <span className={`text-xs px-2 py-1 rounded font-medium ${riskLevel.color}`}>
                {riskLevel.label} ({parent.safeguard?.riskScore}/10)
              </span>
            )}
          </div>

          {/* Summary / content */}
          {content && (
            <div className="mb-3">
              <code className="text-sm text-gc-text-dim bg-gc-bg px-2 py-1 rounded inline-block max-w-full break-words whitespace-pre-wrap">
                {content.substring(0, 200)}{content.length > 200 ? '…' : ''}
              </code>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center space-x-4 mt-2">
            {/* Details button — always shown when there are tool calls */}
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="text-xs text-blue-500 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors flex items-center space-x-1"
            >
              <span>{showDetails ? '▼' : '▶'}</span>
              <span>
                📋 Details ({toolCalls.length} tool{toolCalls.length !== 1 ? 's' : ''}
                {toolNames.length > 0 ? `: ${toolNames.slice(0, 3).join(', ')}${toolNames.length > 3 ? '…' : ''}` : ''})
              </span>
            </button>

            {/* Security Analysis button */}
            {parent.safeguard?.riskScore !== undefined && (
              <button
                onClick={() => setShowAnalysis(!showAnalysis)}
                className="text-xs text-gc-primary hover:text-gc-primary/80 transition-colors flex items-center space-x-1"
              >
                <span>{showAnalysis ? '▼' : '▶'}</span>
                <span>🛡️ Security Analysis ({parent.safeguard?.category || 'general'} - {parent.safeguard?.riskScore}/10)</span>
              </button>
            )}
          </div>

          {/* Streaming steps from the parent event (if backend populated them) */}
          {parent.streamingSteps?.length > 0 && !showDetails && (
            <div className="mt-1 text-xs text-gc-text-dim">
              + {parent.streamingSteps.length} streaming step{parent.streamingSteps.length !== 1 ? 's' : ''} in Details
            </div>
          )}

          {/* ── Details Panel ── */}
          {showDetails && (
            <div className="mt-3 ml-4 space-y-2 bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 rounded p-3">
              <div className="flex items-center space-x-2 mb-2">
                <span className="text-lg">📋</span>
                <span className="text-blue-700 dark:text-blue-300 font-semibold text-sm">
                  Event Details — {toolCalls.length} tool call{toolCalls.length !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Tool call rows (from grouped events) */}
              <div className="space-y-2">
                {toolCalls.map((tc, i) => <ToolCallRow key={tc.id || i} event={tc} />)}
              </div>

              {/* Also show streaming steps from parent if available */}
              {parent.streamingSteps?.length > 0 && (
                <div className="mt-3 pt-3 border-t border-blue-200 dark:border-blue-800">
                  <div className="text-xs text-blue-600 dark:text-blue-400 font-medium mb-2">
                    Streaming Steps ({parent.streamingSteps.length})
                  </div>
                  <div className="space-y-1">
                    {parent.streamingSteps.map((step, idx) => {
                      const stepRisk = step.safeguard ? getRiskLevel(step.safeguard.riskScore) : null;
                      const stepIcon = step.type === 'thinking' ? '💭' :
                                       step.type === 'tool_use' ? '🔧' :
                                       step.type === 'exec' ? '⚡' :
                                       step.type === 'text' ? '💬' : '📝';
                      return (
                        <div key={step.id || idx} className="bg-white dark:bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-700 text-xs">
                          <div className="flex items-center space-x-2">
                            <span>{stepIcon}</span>
                            <span className="font-medium">{step.type === 'tool_use' && step.toolName ? step.toolName : step.type}</span>
                            {stepRisk && (
                              <span className={`px-1.5 py-0.5 rounded font-medium ${stepRisk.color}`}>
                                {stepRisk.label} ({step.safeguard.riskScore})
                              </span>
                            )}
                          </div>
                          {step.content && (
                            <div className="mt-1 text-gray-600 dark:text-gray-400 max-h-20 overflow-y-auto">
                              {step.content}
                            </div>
                          )}
                          {step.metadata?.input && (
                            <code className="block mt-1 bg-gray-100 dark:bg-gray-900 p-1 rounded overflow-x-auto whitespace-pre-wrap">
                              {JSON.stringify(step.metadata.input, null, 2).substring(0, 300)}
                            </code>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Security Analysis Panel ── */}
          {showAnalysis && parent.safeguard && (
            <div className="mt-3 ml-4 space-y-2 text-sm bg-gc-primary/5 p-3 rounded border border-gc-primary/20">
              <div className="flex items-center space-x-2">
                <span className="text-lg">🛡️</span>
                <span className="text-gc-primary font-semibold">Security Analysis</span>
              </div>
              <div><span className="text-gc-text-dim">Risk Score:</span><span className="ml-2 font-medium">{parent.safeguard.riskScore}/10</span></div>
              {parent.safeguard.category && <div><span className="text-gc-text-dim">Category:</span><span className="ml-2">{parent.safeguard.category}</span></div>}
              {parent.safeguard.reasoning && (
                <div><span className="text-gc-text-dim">Reasoning:</span>
                  <p className="mt-1 bg-gc-bg/50 p-2 rounded text-sm">{parent.safeguard.reasoning}</p>
                </div>
              )}
              {parent.safeguard.concerns?.length > 0 && (
                <div>
                  <span className="text-gc-text-dim">Concerns:</span>
                  <ul className="mt-1 list-disc list-inside">
                    {parent.safeguard.concerns.map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                </div>
              )}
              {parent.safeguard.allowed !== undefined && (
                <div>
                  <span className="text-gc-text-dim">Action:</span>
                  <span className={`ml-2 font-medium ${parent.safeguard.allowed ? 'text-gc-safe' : 'text-gc-danger'}`}>
                    {parent.safeguard.allowed ? '✓ Allowed' : '✗ Blocked'}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Timestamp */}
        <div className="text-sm text-gc-text-dim ml-4 whitespace-nowrap flex-shrink-0">
          {formatTime(parent.timestamp || Date.now())}
        </div>
      </div>
    </div>
  );
}

/* ---------- StandaloneEvent: a non-tool-call event with no tool children ---------- */
function StandaloneEvent({ event }) {
  const [showAnalysis, setShowAnalysis] = useState(false);
  const riskLevel = getRiskLevel(event.safeguard?.riskScore);
  const type = event.type || 'unknown';
  const tool = event.tool || event.subType || '';
  const content = event.command || event.description || event.summary || '';

  const displayName =
    type === 'tool-call' ? tool :
    type === 'chat-update' || type === 'chat-message' ? 'chat-message' :
    type === 'exec-started' ? 'exec' :
    type === 'exec-completed' ? 'exec (done)' :
    type;

  return (
    <div className="px-6 py-4 hover:bg-gc-border/10 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center space-x-3 mb-2">
            <span className="text-gc-text font-medium">
              {toolIcon(tool || type)} {displayName}
            </span>
            {event.status === 'aborted' && (
              <span className="text-xs px-2 py-1 rounded bg-gc-text-dim/20 text-gc-text-dim">(aborted)</span>
            )}
            {riskLevel && (
              <span className={`text-xs px-2 py-1 rounded font-medium ${riskLevel.color}`}>
                {riskLevel.label} ({event.safeguard.riskScore}/10)
              </span>
            )}
          </div>

          {content && (
            <div className="mb-3">
              <code className="text-sm text-gc-text-dim bg-gc-bg px-2 py-1 rounded inline-block max-w-full break-words whitespace-pre-wrap">
                {content.substring(0, 200)}{content.length > 200 ? '…' : ''}
              </code>
            </div>
          )}

          {event.safeguard?.riskScore !== undefined && (
            <button
              onClick={() => setShowAnalysis(!showAnalysis)}
              className="text-xs text-gc-primary hover:text-gc-primary/80 transition-colors flex items-center space-x-1"
            >
              <span>{showAnalysis ? '▼' : '▶'}</span>
              <span>🛡️ Security Analysis ({event.safeguard?.category || 'general'} - {event.safeguard?.riskScore}/10)</span>
            </button>
          )}

          {showAnalysis && event.safeguard && (
            <div className="mt-3 ml-4 space-y-2 text-sm bg-gc-primary/5 p-3 rounded border border-gc-primary/20">
              <div className="flex items-center space-x-2">
                <span>🛡️</span>
                <span className="text-gc-primary font-semibold">Security Analysis</span>
              </div>
              <div><span className="text-gc-text-dim">Risk Score:</span><span className="ml-2 font-medium">{event.safeguard.riskScore}/10</span></div>
              {event.safeguard.reasoning && <p className="bg-gc-bg/50 p-2 rounded text-sm">{event.safeguard.reasoning}</p>}
            </div>
          )}
        </div>

        <div className="text-sm text-gc-text-dim ml-4 whitespace-nowrap flex-shrink-0">
          {formatTime(event.timestamp || Date.now())}
        </div>
      </div>
    </div>
  );
}

export default TurnItem;
