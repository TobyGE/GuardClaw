import GuardClawLogo from './GuardClawLogo';
import { TerminalIcon, FileTextIcon, PencilIcon, GlobeIcon, SearchIcon, MessageIcon, BrainIcon, ImageIcon, ServerIcon, BotIcon, GitBranchIcon, ChartIcon, WrenchIcon, HourglassIcon, LinkIcon, MonitorIcon } from './icons';
import { useState } from 'react';

function MemoryHint({ memory, adjustment, originalScore, currentScore }) {
  if (!memory) return null;
  const { approveCount, denyCount, pattern } = memory;
  const total = approveCount + denyCount;
  if (total === 0) return null;

  return (
    <div className="mt-2 p-2.5 rounded-lg bg-gc-primary/5 border border-gc-primary/10 text-xs">
      <div className="flex items-center gap-1.5 font-medium text-gc-primary mb-1">
        <BrainIcon size={12} /> Memory
      </div>
      <div className="text-gc-text-dim space-y-0.5">
        {approveCount > 0 && (
          <div>Approved similar commands <span className="font-medium text-gc-safe">{approveCount}×</span></div>
        )}
        {denyCount > 0 && (
          <div>Denied similar commands <span className="font-medium text-gc-danger">{denyCount}×</span></div>
        )}
        {adjustment != null && adjustment !== 0 && (
          <div className="font-medium">
            Score adjusted: <span className="text-gc-text">{originalScore}</span>
            <span className="mx-1">→</span>
            <span className={adjustment < 0 ? 'text-gc-safe' : 'text-gc-danger'}>{currentScore}</span>
            <span className="opacity-60 ml-1">({adjustment > 0 ? '+' : ''}{adjustment})</span>
          </div>
        )}
        <div className="opacity-60 font-mono text-[10px] truncate" title={pattern}>Pattern: {pattern}</div>
      </div>
    </div>
  );
}

const TOOL_ICON_MAP = {
  exec: TerminalIcon,
  read: FileTextIcon,
  write: PencilIcon,
  edit: PencilIcon,
  web_fetch: GlobeIcon,
  web_search: SearchIcon,
  browser: GlobeIcon,
  message: MessageIcon,
  memory_search: BrainIcon,
  memory_get: BrainIcon,
  image: ImageIcon,
  tts: MessageIcon,
  canvas: ImageIcon,
  nodes: ServerIcon,
  sessions_spawn: GitBranchIcon,
  sessions_send: MessageIcon,
  sessions_list: ChartIcon,
  sessions_history: ChartIcon,
  session_status: ChartIcon,
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

function ToolIcon({ name, size = 14, className = '' }) {
  const Icon = TOOL_ICON_MAP[name] || WrenchIcon;
  return <Icon size={size} className={className} />;
}

function getRiskLevel(score, pending) {
  if (pending) return { label: 'ANALYZING', color: 'text-blue-400 bg-blue-400/20 animate-pulse', dot: 'bg-blue-400 animate-pulse' };
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

/* ---------- ToolOutput: collapsible tool result display ---------- */
const OUTPUT_PREVIEW = 300;
function ToolOutput({ result, label = 'Output' }) {
  const [expanded, setExpanded] = useState(false);
  if (!result) return null;
  const hasMore = result.length > OUTPUT_PREVIEW;
  const display = expanded || !hasMore ? result : result.substring(0, OUTPUT_PREVIEW);
  return (
    <div>
      <span className="text-xs text-gc-text-dim">{label}:</span>
      <code
        className="block mt-1 text-xs bg-black/30 p-2 rounded break-words whitespace-pre-wrap max-h-64 overflow-y-auto border border-gc-border/40 cursor-pointer"
        onClick={() => hasMore && setExpanded(!expanded)}
      >
        {display}
        {hasMore && !expanded && <span className="text-blue-400 ml-1">… show more</span>}
        {hasMore && expanded && <span className="text-blue-400 ml-1"> show less</span>}
      </code>
    </div>
  );
}

/* ---------- Memory Feedback Buttons ---------- */
function MemoryFeedback({ event }) {
  const [status, setStatus] = useState(null); // null | 'approve' | 'deny'
  const [loading, setLoading] = useState(false);

  const record = async (decision) => {
    if (loading) return;
    const toolName = event.tool || event.subType || 'exec';
    const command = event.command || event.description || '';

    // Clicking the active button again → un-mark (reset UI, tell server to reset)
    if (status === decision) {
      setLoading(true);
      await fetch('/api/memory/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName, command, riskScore: event.safeguard?.riskScore || 0, decision: 'neutral', sessionKey: event.sessionKey || null }),
      }).catch(() => {});
      setStatus(null);
      setLoading(false);
      return;
    }

    // New decision (or switching from the other button)
    setLoading(true);
    try {
      const res = await fetch('/api/memory/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName, command, riskScore: event.safeguard?.riskScore || 0, decision, sessionKey: event.sessionKey || null }),
      });
      if (res.ok) setStatus(decision);
    } catch {}
    setLoading(false);
  };

  return (
    <span className="inline-flex items-center ml-2 gap-1">
      <button
        onClick={(e) => { e.stopPropagation(); record('approve'); }}
        disabled={loading}
        className={`text-xs px-1.5 py-0.5 rounded border transition-colors ${
          status === 'approve'
            ? 'bg-green-600 border-green-600 text-white font-medium'
            : 'border-green-700/50 text-green-400 hover:bg-green-900/30'
        }`}
        title="Train memory: similar commands are safe"
      >✓ Safe</button>
      <button
        onClick={(e) => { e.stopPropagation(); record('deny'); }}
        disabled={loading}
        className={`text-xs px-1.5 py-0.5 rounded border transition-colors ${
          status === 'deny'
            ? 'bg-red-600 border-red-600 text-white font-medium'
            : 'border-red-700/50 text-red-400 hover:bg-red-900/30'
        }`}
        title="Train memory: similar commands are risky"
      >✕ Risk</button>
    </span>
  );
}

/* ---------- ToolCallRow: one collapsed/expanded tool call ---------- */
function ToolCallRow({ event }) {
  const [open, setOpen] = useState(false);
  const riskLevel = getRiskLevel(event.safeguard?.riskScore, event.safeguard?.pending);
  const name = event.tool || event.subType || 'tool';
  // Try multiple locations for tool input args
  const rawContent = event.rawEvent?.content;
  const toolCallBlock = Array.isArray(rawContent) ? rawContent.find(b => b.type === 'toolCall' || b.type === 'tool_use') : null;
  const input = event.metadata?.input || event.parsedInput || event.payload?.data?.args || event.payload?.data?.input || toolCallBlock?.arguments || toolCallBlock?.input || {};
  let desc = event.command || event.description || '';
  let fullDesc = null; // full content for expanded view
  // Enrich edit/write display with actual content
  if (name === 'edit' && !desc.includes('old:')) {
    const file = input.file_path || input.path || '';
    const oldStr = input.old_string || input.oldText || '';
    const newStr = input.new_string || input.newText || '';
    if (oldStr || newStr) {
      desc = `edit ${file}\n--- old: ${oldStr.substring(0, 80)}${oldStr.length > 80 ? '…' : ''}\n+++ new: ${newStr.substring(0, 80)}${newStr.length > 80 ? '…' : ''}`;
      fullDesc = `edit ${file}\n--- old:\n${oldStr}\n+++ new:\n${newStr}`;
    }
  } else if (name === 'write' && !desc.includes('\n')) {
    const file = input.file_path || input.path || '';
    const content = input.content || '';
    if (content) {
      desc = `write ${file}\n${content.substring(0, 100)}${content.length > 100 ? '…' : ''}`;
      fullDesc = `write ${file}\n${content}`;
    }
  } else if (name === 'message') {
    const target = input.target || input.channel || '';
    const msg = input.message || '';
    if (msg) {
      desc = `message → ${target}\n${msg.substring(0, 100)}${msg.length > 100 ? '…' : ''}`;
      fullDesc = `message → ${target}\n${msg}`;
    }
  } else if (name === 'sessions_send') {
    const target = input.sessionKey || input.label || '';
    const msg = input.message || '';
    if (msg) {
      desc = `sessions_send → ${target}\n${msg.substring(0, 100)}${msg.length > 100 ? '…' : ''}`;
      fullDesc = `sessions_send → ${target}\n${msg}`;
    }
  } else if (name === 'browser') {
    const action = input.action || '';
    const url = input.targetUrl || input.url || '';
    desc = `browser ${action}${url ? ' ' + url : ''}`;
  } else if (name === 'web_fetch') {
    const url = input.url || '';
    if (url) desc = `web_fetch ${url}`;
  }

  return (
    <div className="rounded border border-gc-border bg-gc-bg/60">
      <button
        className="w-full flex items-start justify-between px-3 py-2 text-left hover:bg-gc-border/20 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center space-x-2 flex-1 min-w-0">
          <ToolIcon name={name} size={16} className="text-gc-text-dim" />
          <span className="text-sm font-medium text-gc-text">{name}</span>
          {riskLevel && (
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${riskLevel.color}`}>
              {riskLevel.label}
            </span>
          )}
          {event.safeguard?.chainRisk && (
            <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-purple-900/40 text-purple-300 border border-purple-700/50">
              <><LinkIcon size={12} className="inline" /> chain</>
            </span>
          )}
          {desc && (
            <code className="text-xs text-gc-text-dim truncate max-w-xs">
              {desc.substring(0, 80)}{desc.length > 80 ? '…' : ''}
            </code>
          )}
          {event.safeguard?.riskScore != null && <MemoryFeedback event={event} />}
        </div>
        <span className="text-gc-text-dim text-xs ml-2 flex-shrink-0">{open ? '▼' : '▶'}</span>
      </button>

      {open && (
        <div className="border-t border-gc-border px-3 py-3 space-y-2">
          {/* Full description / command */}
          {(fullDesc || desc) && (
            <ToolOutput result={fullDesc || desc} label="Input" />
          )}

          {/* Tool output (from after_tool_call hook) */}
          {event.toolResult && (
            <ToolOutput result={event.toolResult} />
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
              <span className="font-medium text-gc-primary inline-flex items-center gap-1"><GuardClawLogo size={16} /> Security Analysis</span>
              {event.safeguard.category && <div><span className="text-gc-text-dim">Category: </span>{event.safeguard.category}</div>}
              {event.safeguard.reasoning && <div className="text-gc-text-dim italic">{event.safeguard.reasoning}</div>}
              {event.safeguard.concerns?.length > 0 && (
                <ul className="list-disc list-inside text-gc-warning">
                  {event.safeguard.concerns.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              )}
              {event.safeguard.memory && <MemoryHint memory={event.safeguard.memory} adjustment={event.safeguard.memoryAdjustment} originalScore={event.safeguard.originalRiskScore} currentScore={event.safeguard.riskScore} />}
            </div>
          )}

          <div className="text-xs text-gc-text-dim">{formatTime(event.timestamp || Date.now())}</div>
        </div>
      )}
    </div>
  );
}

/* ---------- ReplyText: expandable agent reply snippet ---------- */
const REPLY_PREVIEW = 200;

function ReplyText({ text, expanded, onToggle }) {
  if (!text) return null;
  const hasMore = text.length > REPLY_PREVIEW;
  return (
    <p
      className="text-sm text-gc-text bg-gc-bg px-3 py-2 rounded border-l-2 border-blue-400/50 break-words whitespace-pre-wrap cursor-default"
      onClick={hasMore ? onToggle : undefined}
      style={hasMore ? { cursor: 'pointer' } : {}}
    >
      {expanded || !hasMore ? text : text.substring(0, REPLY_PREVIEW)}
      {hasMore && !expanded && (
        <span className="text-blue-400 ml-1 select-none">… show more</span>
      )}
      {hasMore && expanded && (
        <span className="text-blue-400 ml-1 select-none"> show less</span>
      )}
    </p>
  );
}

/* ---------- TurnItem: one agent response turn ---------- */
function CCTurnItem({ turn }) {
  const { toolCalls, userPrompt, replies = [] } = turn;
  const [showDetails, setShowDetails] = useState(false);
  const [expandedReplies, setExpandedReplies] = useState({});

  const hasReplies = replies.length > 0;
  const lastReply = replies[replies.length - 1];
  const promptText = userPrompt?.text || '';
  const ts = lastReply?.timestamp || toolCalls[toolCalls.length - 1]?.timestamp || userPrompt?.timestamp;

  const toggleReply = (i) => setExpandedReplies(v => ({ ...v, [i]: !v[i] }));

  return (
    <div className="px-6 py-4 hover:bg-gc-border/10 transition-colors">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {hasReplies
            ? <BotIcon size={16} className="text-purple-500" />
            : <HourglassIcon size={16} className="text-gc-warning animate-pulse" />
          }
          <span className="text-xs font-semibold text-purple-600 bg-purple-50 border border-purple-200 rounded-full px-2 py-0.5">
            Claude Code
          </span>
          {toolCalls.length > 0 && (
            <span className="text-xs text-gc-text-dim bg-gc-border/40 px-2 py-0.5 rounded">
              {summarizeToolCalls(toolCalls)}
            </span>
          )}
          {!hasReplies && (
            <span className="text-xs text-gc-warning">working…</span>
          )}
        </div>
        {ts && <span className="text-xs text-gc-text-dim whitespace-nowrap">{formatTime(ts)}</span>}
      </div>

      {/* User prompt bubble */}
      {promptText && (
        <div className="mb-3 flex justify-end">
          <div className="max-w-[85%] bg-gc-primary/10 border border-gc-primary/20 rounded-xl rounded-tr-sm px-3 py-2">
            <p className="text-xs text-gc-text leading-relaxed whitespace-pre-wrap">{promptText}</p>
          </div>
        </div>
      )}

      {/* Tool calls */}
      {toolCalls.length > 0 && (
        <div className="mb-3">
          <button
            onClick={() => setShowDetails(v => !v)}
            className="text-xs text-gc-text-dim hover:text-gc-text transition-colors flex items-center gap-1 mb-2"
          >
            <span>{showDetails ? '▼' : '▶'}</span>
            <span>{toolCalls.length} tool call{toolCalls.length !== 1 ? 's' : ''}</span>
          </button>
          {showDetails && (
            <div className="space-y-2">
              {toolCalls.map((tc, i) => <ToolCallRow key={tc.id || i} event={tc} />)}
            </div>
          )}
        </div>
      )}

      {/* All reply segments in order */}
      {replies.map((reply, i) => (
        <div key={reply.id || i} className="border-l-2 border-purple-300/50 pl-3 mb-2">
          {replies.length > 1 && (
            <span className="text-[10px] text-purple-400/60 font-mono mb-1 block">
              {i < replies.length - 1 ? '◎ intermediate' : '◉ final'}
            </span>
          )}
          <ReplyText text={reply.text || ''} expanded={!!expandedReplies[i]} onToggle={() => toggleReply(i)} />
        </div>
      ))}
    </div>
  );
}

function TurnItem({ turn }) {
  const { parent, toolCalls, reply } = turn;
  const [showDetails, setShowDetails] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [showFullReply, setShowFullReply] = useState(false);

  // ── Case 0: Claude Code turn ──
  if (turn.isCCTurn) return <CCTurnItem turn={turn} />;

  // ── Case 1: orphan tool-calls only (agent still running / no parent) ──
  if (!parent) {
    const summary = summarizeToolCalls(toolCalls);
    const replyText = reply?.description || reply?.summary || '';
    const ts = toolCalls.length > 0 ? toolCalls[toolCalls.length - 1].timestamp : null;
    return (
      <div className="px-6 py-4 hover:bg-gc-border/10 transition-colors">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {replyText
              ? <BotIcon size={16} className="text-gc-primary" />
              : <HourglassIcon size={16} className="text-gc-warning animate-pulse" />
            }
            <span className="text-xs font-semibold text-blue-600 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5">
              OpenClaw
            </span>
            {toolCalls.length > 0 && (
              <span className="text-xs text-gc-text-dim bg-gc-border/40 px-2 py-0.5 rounded">{summary}</span>
            )}
            {!replyText && (
              <span className="text-xs text-gc-warning">working…</span>
            )}
          </div>
          {ts && <span className="text-xs text-gc-text-dim whitespace-nowrap">{formatTime(ts)}</span>}
        </div>

        {/* Reply text */}
        {replyText && (
          <div className="border-l-2 border-blue-300/50 pl-3 mb-3">
            <ReplyText text={replyText} expanded={showFullReply} onToggle={() => setShowFullReply(v => !v)} />
          </div>
        )}

        {/* Tool calls */}
        {toolCalls.length > 0 && (
          <div>
            <button
              onClick={() => setShowDetails(v => !v)}
              className="text-xs text-gc-text-dim hover:text-gc-text transition-colors flex items-center gap-1 mb-2"
            >
              <span>{showDetails ? '▼' : '▶'}</span>
              <span>{toolCalls.length} tool call{toolCalls.length !== 1 ? 's' : ''}</span>
            </button>
            {showDetails && (
              <div className="space-y-2">
                {toolCalls.map((tc, i) => <ToolCallRow key={tc.id || i} event={tc} />)}
              </div>
            )}
          </div>
        )}
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
  const riskLevel = getRiskLevel(parent.safeguard?.riskScore, parent.safeguard?.pending);
  const replyText = reply?.description || reply?.summary || parent.description || parent.summary || '';
  const isContext = parent.safeguard?.isContext;
  const toolSummary = summarizeToolCalls(toolCalls);
  const ts = parent.timestamp || toolCalls[toolCalls.length - 1]?.timestamp;

  return (
    <div className="px-6 py-4 hover:bg-gc-border/10 transition-colors">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <BotIcon size={16} className="text-gc-primary" />
          <span className="text-xs font-semibold text-blue-600 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5">
            OpenClaw
          </span>
          {toolCalls.length > 0 && (
            <span className="text-xs text-gc-text-dim bg-gc-border/40 px-2 py-0.5 rounded">{toolSummary}</span>
          )}
          {riskLevel && !isContext && (
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${riskLevel.color}`}>
              {riskLevel.label}
            </span>
          )}
        </div>
        {ts && <span className="text-xs text-gc-text-dim whitespace-nowrap">{formatTime(ts)}</span>}
      </div>

      {/* Reply text */}
      {replyText && (
        <div className="border-l-2 border-blue-300/50 pl-3 mb-3">
          <ReplyText text={replyText} expanded={showFullReply} onToggle={() => setShowFullReply(v => !v)} />
        </div>
      )}

      {/* Tool calls */}
      {toolCalls.length > 0 && (
        <div className="mb-2">
          <button
            onClick={() => setShowDetails(v => !v)}
            className="text-xs text-gc-text-dim hover:text-gc-text transition-colors flex items-center gap-1 mb-2"
          >
            <span>{showDetails ? '▼' : '▶'}</span>
            <span>{toolCalls.length} tool call{toolCalls.length !== 1 ? 's' : ''}</span>
          </button>
          {showDetails && (
            <div className="space-y-2">
              {toolCalls.map((tc, i) => <ToolCallRow key={tc.id || i} event={tc} />)}
            </div>
          )}
        </div>
      )}

      {/* Security Analysis */}
      {!isContext && parent.safeguard?.riskScore != null && (
        <div className="mt-1">
          <button
            onClick={() => setShowAnalysis(!showAnalysis)}
            className="text-xs text-gc-primary hover:text-gc-primary/80 transition-colors flex items-center space-x-1"
          >
            <span>{showAnalysis ? '▼' : '▶'}</span>
            <span className="inline-flex items-center gap-1">
              <GuardClawLogo size={14} /> Security Analysis ({parent.safeguard?.category || 'general'})
            </span>
          </button>

          {showAnalysis && parent.safeguard && (
            <div className="mt-2 ml-4 space-y-2 text-sm bg-gc-primary/5 p-3 rounded border border-gc-primary/20">
              <div className="flex items-center space-x-2">
                <GuardClawLogo size={16} />
                <span className="text-gc-primary font-semibold">Security Analysis</span>
              </div>
              <div>
                <span className="text-gc-text-dim">Verdict: </span>
                <span className="font-medium">
                  {parent.safeguard.riskScore <= 3 ? 'SAFE' : parent.safeguard.riskScore <= 7 ? 'WARNING' : 'BLOCKED'}
                </span>
              </div>
              {parent.safeguard.category && (
                <div><span className="text-gc-text-dim">Category: </span>{parent.safeguard.category}</div>
              )}
              {parent.safeguard.reasoning && (
                <div>
                  <span className="text-gc-text-dim">Reasoning:</span>
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
                  <span className="text-gc-text-dim">Action: </span>
                  <span className={`font-medium ${parent.safeguard.allowed ? 'text-gc-safe' : 'text-gc-danger'}`}>
                    {parent.safeguard.allowed ? '✓ Allowed' : '✗ Blocked'}
                  </span>
                </div>
              )}
              {parent.safeguard.memory && (
                <MemoryHint
                  memory={parent.safeguard.memory}
                  adjustment={parent.safeguard.memoryAdjustment}
                  originalScore={parent.safeguard.originalRiskScore}
                  currentScore={parent.safeguard.riskScore}
                />
              )}
            </div>
          )}
        </div>
      )}
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
              {isFinal ? <><BotIcon size={12} className="inline mr-1" /> Agent</> : <><MessageIcon size={12} className="inline mr-1" /> Chat</>}
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
  const riskLevel = getRiskLevel(event.safeguard?.riskScore, event.safeguard?.pending);
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
              <><ToolIcon name={tool || type} size={13} className="inline mr-1" /> {displayName}</>
            </span>
            {event.status === 'aborted' && (
              <span className="text-xs px-2 py-1 rounded bg-gc-text-dim/20 text-gc-text-dim">(aborted)</span>
            )}
            {riskLevel && (
              <span className={`text-xs px-2 py-1 rounded font-medium ${riskLevel.color}`}>
                {riskLevel.label}
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
              <span className='inline-flex items-center gap-1'><GuardClawLogo size={14} /> Security Analysis ({event.safeguard?.category || 'general'})</span>
            </button>
          )}

          {showAnalysis && event.safeguard && (
            <div className="mt-3 ml-4 space-y-2 text-sm bg-gc-primary/5 p-3 rounded border border-gc-primary/20">
              <div className="flex items-center space-x-2">
                <GuardClawLogo size={16} />
                <span className="text-gc-primary font-semibold">Security Analysis</span>
              </div>
              <div><span className="text-gc-text-dim">Verdict:</span><span className="ml-2 font-medium">{event.safeguard.riskScore <= 3 ? 'SAFE' : event.safeguard.riskScore <= 7 ? 'WARNING' : 'BLOCKED'}</span></div>
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
