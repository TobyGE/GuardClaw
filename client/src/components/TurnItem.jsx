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

// Generate a human-readable summary from a list of tool-call events
function summarizeToolCalls(toolCalls) {
  if (!toolCalls.length) return '';

  // Count by tool name
  const counts = {};
  for (const tc of toolCalls) {
    const name = tc.tool || tc.subType || 'tool';
    counts[name] = (counts[name] || 0) + 1;
  }

  const labels = {
    exec: (n) => `running ${n} command${n > 1 ? 's' : ''}`,
    read: (n) => `reading ${n} file${n > 1 ? 's' : ''}`,
    write: (n) => `writing ${n} file${n > 1 ? 's' : ''}`,
    edit: (n) => `editing ${n} file${n > 1 ? 's' : ''}`,
    web_fetch: (n) => `fetching ${n} URL${n > 1 ? 's' : ''}`,
    web_search: (n) => `searching the web`,
    browser: (n) => `browsing`,
    message: (n) => `sending ${n} message${n > 1 ? 's' : ''}`,
    memory_search: (n) => `searching memory`,
    memory_get: (n) => `reading memory`,
    image: (n) => `analyzing image${n > 1 ? 's' : ''}`,
    tts: (n) => `generating speech`,
  };

  const parts = Object.entries(counts).map(([name, n]) =>
    labels[name] ? labels[name](n) : `${name}${n > 1 ? ` ×${n}` : ''}`
  );

  return parts.join(', ');
}

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
  const { parent, toolCalls, reply } = turn;
  const [showDetails, setShowDetails] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);

  // ── Case 1: orphan tool-calls only (agent still running / no parent) ──
  if (!parent) {
    const summary = summarizeToolCalls(toolCalls);
    const replyText = reply?.description || reply?.summary || '';
    return (
      <div className="px-6 py-4 hover:bg-gc-border/10 transition-colors">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2 flex-wrap gap-y-1">
            {replyText
              ? <span className="text-base">🤖</span>
              : <span className="text-gc-text-dim text-sm animate-pulse">⏳</span>
            }
            <span className="text-sm font-medium text-gc-text-dim">
              {replyText ? 'Agent turn' : 'Agent working…'}
            </span>
            <span className="text-xs text-gc-text-dim bg-gc-border/40 px-2 py-0.5 rounded">{summary}</span>
          </div>
          <span className="text-xs text-gc-text-dim ml-4 whitespace-nowrap">
            {toolCalls[0] ? formatTime(toolCalls[0].timestamp) : ''}
          </span>
        </div>
        {/* Agent reply text */}
        {replyText && (
          <p className="text-sm text-gc-text mb-3 bg-gc-bg px-3 py-2 rounded border-l-2 border-blue-400/50">
            {replyText.substring(0, 300)}{replyText.length > 300 ? '…' : ''}
          </p>
        )}
        <div className="space-y-2">
          {toolCalls.map((tc, i) => <ToolCallRow key={tc.id || i} event={tc} />)}
        </div>
      </div>
    );
  }

  // ── Case 2: standalone event (no tool calls) ──
  if (toolCalls.length === 0) {
    // Chat messages with no tool calls → render as conversation context bubble
    const isChat = parent.type === 'chat-update' || parent.type === 'chat-message';
    if (isChat || parent.safeguard?.isContext) {
      return <ChatContextBubble event={parent} />;
    }
    return <StandaloneEvent event={parent} />;
  }

  // ── Case 3: chat-update/chat-message with tool calls → full turn ──
  const riskLevel = getRiskLevel(parent.safeguard?.riskScore);
  // Prefer: actual agent reply text > parent description > AI-generated summary
  const replyText = reply?.description || reply?.summary || parent.description || parent.summary || '';
  const isContext = parent.safeguard?.isContext;

  // Determine how many unique tool names
  const toolNames = [...new Set(toolCalls.map(tc => tc.tool || tc.subType).filter(Boolean))];
  const toolSummary = summarizeToolCalls(toolCalls);

  return (
    <div className="px-6 py-4 hover:bg-gc-border/10 transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center space-x-3 mb-2">
            <span className="text-gc-text font-medium">🤖 Agent turn</span>
            {riskLevel && !isContext && (
              <span className={`text-xs px-2 py-1 rounded font-medium ${riskLevel.color}`}>
                {riskLevel.label} ({parent.safeguard?.riskScore}/10)
              </span>
            )}
          </div>

          {/* Agent reply text */}
          {replyText && (
            <div className="mb-3">
              <p className="text-sm text-gc-text bg-gc-bg px-3 py-2 rounded border-l-2 border-blue-400/50 break-words">
                {replyText.substring(0, 300)}{replyText.length > 300 ? '…' : ''}
              </p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center space-x-4 mt-2">
            {/* Details button */}
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="text-xs text-blue-500 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors flex items-center space-x-1"
            >
              <span>{showDetails ? '▼' : '▶'}</span>
              <span>📋 Details ({toolSummary})</span>
            </button>

            {/* Security Analysis button — only if actually scored (not context) */}
            {!isContext && parent.safeguard?.riskScore != null && (
              <button
                onClick={() => setShowAnalysis(!showAnalysis)}
                className="text-xs text-gc-primary hover:text-gc-primary/80 transition-colors flex items-center space-x-1"
              >
                <span>{showAnalysis ? '▼' : '▶'}</span>
                <span>🛡️ Security Analysis ({parent.safeguard?.category || 'general'} — {parent.safeguard?.riskScore}/10)</span>
              </button>
            )}
          </div>

          {/* streamingSteps hint removed — Details button already shows the count */}

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

              {/* streamingSteps from parent removed — tool calls shown via ToolCallRow above */}
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

/* ---------- ChatContextBubble: conversation message shown as context, not a security event ---------- */
function ChatContextBubble({ event }) {
  const [expanded, setExpanded] = useState(false);
  const content = event.summary || event.description || '';
  const isFinal = event.subType === 'final' || event.type === 'chat-message';
  const preview = content.substring(0, 120);
  const hasMore = content.length > 120;

  return (
    <div className="px-6 py-3 hover:bg-gc-border/5 transition-colors border-l-2 border-blue-400/30">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center space-x-2 mb-1">
            <span className="text-xs font-medium text-blue-500 dark:text-blue-400">
              {isFinal ? '🤖 Agent' : '💬 Chat'}
            </span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
              context
            </span>
          </div>
          {content && (
            <div
              className="text-sm text-gc-text-dim cursor-pointer"
              onClick={() => hasMore && setExpanded(!expanded)}
            >
              {expanded ? content : preview}
              {hasMore && !expanded && (
                <span className="text-blue-400 ml-1">… show more</span>
              )}
              {hasMore && expanded && (
                <span className="text-blue-400 ml-1 cursor-pointer" onClick={() => setExpanded(false)}> show less</span>
              )}
            </div>
          )}
        </div>
        <div className="text-xs text-gc-text-dim ml-4 whitespace-nowrap flex-shrink-0">
          {formatTime(event.timestamp || Date.now())}
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

          {event.safeguard?.riskScore != null && (
            <button
              onClick={() => setShowAnalysis(!showAnalysis)}
              className="text-xs text-gc-primary hover:text-gc-primary/80 transition-colors flex items-center space-x-1"
            >
              <span>{showAnalysis ? '▼' : '▶'}</span>
              <span>🛡️ Security Analysis ({event.safeguard?.category || 'general'} — {event.safeguard?.riskScore}/10)</span>
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
