import GuardClawLogo from './GuardClawLogo';
import { TerminalIcon, FileTextIcon, PencilIcon, GlobeIcon, SearchIcon, MessageIcon, BrainIcon, ImageIcon, ServerIcon, BotIcon, GitBranchIcon, ChartIcon, WrenchIcon, HourglassIcon, LinkIcon, MonitorIcon } from './icons';
import { useState } from 'react';
import { useI18n } from '../i18n/I18nContext.jsx';

function MemoryHint({ memory, adjustment, originalScore, currentScore }) {
  const { t } = useI18n();
  if (!memory) return null;
  const { approveCount, denyCount, pattern } = memory;
  const total = approveCount + denyCount;
  if (total === 0) return null;

  return (
    <div className="mt-2 p-2.5 rounded-lg bg-gc-primary/5 border border-gc-primary/10 text-xs">
      <div className="flex items-center gap-1.5 font-medium text-gc-primary mb-1">
        <BrainIcon size={12} /> {t('memory.title')}
      </div>
      <div className="text-gc-text-dim space-y-0.5">
        {approveCount > 0 && (
          <div>{t('memory.approvedSimilar')} <span className="font-medium text-gc-safe">{approveCount}×</span></div>
        )}
        {denyCount > 0 && (
          <div>{t('memory.deniedSimilar')} <span className="font-medium text-gc-danger">{denyCount}×</span></div>
        )}
        {adjustment != null && adjustment !== 0 && (
          <div className="font-medium">
            {t('memory.scoreAdjusted')} <span className="text-gc-text">{originalScore}</span>
            <span className="mx-1">→</span>
            <span className={adjustment < 0 ? 'text-gc-safe' : 'text-gc-danger'}>{currentScore}</span>
            <span className="opacity-60 ml-1">({adjustment > 0 ? '+' : ''}{adjustment})</span>
          </div>
        )}
        <div className="opacity-60 font-mono text-[10px] truncate" title={pattern}>{t('memory.patternLabel')} {pattern}</div>
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
function summarizeToolCalls(toolCalls, t) {
  if (!toolCalls.length) return '';

  // Count by tool name
  const counts = {};
  for (const tc of toolCalls) {
    const name = tc.tool || tc.subType || 'tool';
    counts[name] = (counts[name] || 0) + 1;
  }

  const labels = {
    exec: (n) => t('toolSummary.running', { n, plural: n > 1 ? 's' : '' }),
    read: (n) => t('toolSummary.reading', { n, plural: n > 1 ? 's' : '' }),
    write: (n) => t('toolSummary.writing', { n, plural: n > 1 ? 's' : '' }),
    edit: (n) => t('toolSummary.editing', { n, plural: n > 1 ? 's' : '' }),
    web_fetch: (n) => t('toolSummary.fetching', { n, plural: n > 1 ? 's' : '' }),
    web_search: () => t('toolSummary.searching'),
    browser: () => t('toolSummary.browsing'),
    message: (n) => t('toolSummary.sending', { n, plural: n > 1 ? 's' : '' }),
    memory_search: () => t('toolSummary.searchingMemory'),
    memory_get: () => t('toolSummary.readingMemory'),
    image: (n) => t('toolSummary.analyzingImage', { plural: n > 1 ? 's' : '' }),
    tts: () => t('toolSummary.generatingSpeech'),
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

function getRiskLevel(score, pending, verdict) {
  if (pending) return { label: 'ANALYZING', color: 'text-blue-400 bg-blue-400/20 animate-pulse', dot: 'bg-blue-400 animate-pulse' };
  if (score === undefined || score === null) return null;
  if (score < 6) return { label: 'SAFE', color: 'text-gc-safe bg-gc-safe/20', dot: 'bg-gc-safe' };
  if (score < 9) return { label: 'WARNING', color: 'text-gc-warning bg-gc-warning/20', dot: 'bg-gc-warning' };
  // High risk: show BLOCKED only if blocking was active (verdict='ask'/'denied'),
  // otherwise show FLAGGED (monitor-only mode, verdict='pass-through')
  if (verdict === 'pass-through') return { label: 'FLAGGED', color: 'text-gc-danger bg-gc-danger/20', dot: 'bg-gc-danger' };
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
function ToolOutput({ result, label }) {
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
  const { t } = useI18n();
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
        title={t('turnItem.safeTitle')}
      >{t('turnItem.safeTrain')}</button>
      <button
        onClick={(e) => { e.stopPropagation(); record('deny'); }}
        disabled={loading}
        className={`text-xs px-1.5 py-0.5 rounded border transition-colors ${
          status === 'deny'
            ? 'bg-red-600 border-red-600 text-white font-medium'
            : 'border-red-700/50 text-red-400 hover:bg-red-900/30'
        }`}
        title={t('turnItem.riskTitle')}
      >{t('turnItem.riskTrain')}</button>
    </span>
  );
}

/* ---------- ToolCallRow: one collapsed/expanded tool call ---------- */
function ToolCallRow({ event }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const riskLevel = getRiskLevel(event.safeguard?.riskScore, event.safeguard?.pending, event.safeguard?.verdict);
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
              <><LinkIcon size={12} className="inline" /> {t('turnItem.chain')}</>
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
            <ToolOutput result={fullDesc || desc} label={t('eventItem.input').replace(':', '') || 'Input'} />
          )}

          {/* Tool output (from after_tool_call hook) */}
          {event.toolResult && (
            <ToolOutput result={event.toolResult} label={t('turnItem.output')} />
          )}

          {/* streamingSteps for this specific tool-call (if any) */}
          {event.streamingSteps?.length > 0 && (
            <div>
              <span className="text-xs text-gc-text-dim">{t('turnItem.streamingSteps')}</span>
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
              <span className="font-medium text-gc-primary inline-flex items-center gap-1"><GuardClawLogo size={16} /> {t('analysis.securityAnalysis')}</span>
              {event.safeguard.category && <div><span className="text-gc-text-dim">{t('analysis.category')} </span>{event.safeguard.category}</div>}
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

/* ---------- ReplyText: 2-line preview with expand ---------- */
function ReplyText({ text, expanded, onToggle, t }) {
  if (!text) return null;
  // Collapse if >2 non-empty lines OR >100 chars (catches long single-line text on narrow screens)
  const hasMore = text.includes('\n') ? text.split('\n').filter(l => l.trim()).length > 2 : text.length > 100;
  return (
    <div
      className={`text-sm text-gc-text bg-gc-bg px-3 py-2 rounded break-words whitespace-pre-wrap ${hasMore ? 'cursor-pointer' : 'cursor-default'}`}
      onClick={hasMore ? onToggle : undefined}
    >
      <p className={!expanded && hasMore ? 'line-clamp-2' : ''}>{text}</p>
      {hasMore && !expanded && (
        <span className="text-blue-400 text-xs mt-1 block select-none">show more ▼</span>
      )}
      {hasMore && expanded && (
        <span className="text-blue-400 text-xs mt-1 block select-none">show less ▲</span>
      )}
    </div>
  );
}

/* ---------- IntermediateText: assistant text shown inline in tool call list ---------- */
function IntermediateText({ text }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;
  const lines = text.split('\n');
  const MAX_LINES = 2;
  const hasMore = lines.length > MAX_LINES || text.length > 120;
  const preview = hasMore ? lines.slice(0, MAX_LINES).join('\n').slice(0, 120) : text;
  return (
    <div
      className={`text-xs text-gc-text bg-purple-500/10 border border-purple-400/20 rounded-lg px-3 py-2 ${hasMore ? 'cursor-pointer' : ''}`}
      onClick={() => hasMore && setExpanded(v => !v)}
    >
      <span className="text-purple-400 text-[10px] font-semibold mr-1.5">{t('turnItem.assistant')}</span>
      <span className="whitespace-pre-wrap break-words">
        {expanded ? text : preview}{!expanded && hasMore ? '...' : ''}
      </span>
      {hasMore && !expanded && (
        <span className="text-blue-400 text-[10px] mt-1 block select-none">show more ▼</span>
      )}
      {hasMore && expanded && (
        <span className="text-blue-400 text-[10px] mt-1 block select-none">show less ▲</span>
      )}
    </div>
  );
}

/* ---------- AgentTurnItem: unified turn display for OpenClaw + Claude Code ----------
 *
 * Both bots produce the same structure:
 *   userPrompt (optional) → toolCalls → agentReplies
 *
 * OpenClaw: no user prompt (GuardClaw doesn't receive inbound user messages);
 *           single reply from parent.description/summary; risk scoring available.
 * Claude Code: userPrompt from claude-code-prompt event; multiple reply segments;
 *              no turn-level risk scoring (per-tool scoring happens in ToolCallRow).
 *
 * Source is determined by turn.isCCTurn and turn.parent?.gatewaySource.
 */
function AgentTurnItem({ turn }) {
  const { t, language } = useI18n();
  const isCCTurn = !!turn.isCCTurn;
  const isQclawTurn = !isCCTurn && turn.parent?.gatewaySource === 'qclaw';
  const toolCalls = turn.toolCalls || [];

  // ── Normalize agent replies ──
  let agentReplies = [];
  if (isCCTurn) {
    agentReplies = (turn.replies || []).map((r, i, arr) => ({
      text: r.text || '',
      isFinal: i === arr.length - 1,
      id: r.id,
    }));
  } else if (turn.parent) {
    const text = turn.reply?.description || turn.reply?.summary
      || turn.parent?.description || turn.parent?.summary || '';
    if (text) agentReplies = [{ text, isFinal: true, id: turn.parent.id }];
  }

  // A turn is "in progress" only if it has NO replies AND no intermediate text messages yet
  const hasTextMessages = toolCalls.some(tc => tc.type === 'claude-code-text');
  const isInProgress = agentReplies.length === 0 && !hasTextMessages;

  // ── Timestamp ──
  const ts = isCCTurn
    ? (turn.replies?.[turn.replies.length - 1]?.timestamp
        || toolCalls[toolCalls.length - 1]?.timestamp
        || turn.userPrompt?.timestamp)
    : (turn.parent?.timestamp || toolCalls[toolCalls.length - 1]?.timestamp);

  // ── Risk (OpenClaw only — from parent event's safeguard) ──
  const parentSafeguard = isCCTurn ? null : (turn.parent?.safeguard || null);
  const isContext = parentSafeguard?.isContext;
  const riskLevel = getRiskLevel(parentSafeguard?.riskScore, parentSafeguard?.pending, parentSafeguard?.verdict);

  // ── Visual identity ──
  const pill = isCCTurn
    ? 'text-purple-600 bg-purple-50 border-purple-200'
    : isQclawTurn
    ? 'text-orange-600 bg-orange-50 border-orange-200'
    : 'text-blue-600 bg-blue-50 border-blue-200';
  const pillLabel = isCCTurn ? 'Claude Code' : isQclawTurn ? 'Qclaw' : 'OpenClaw';
  const botColor = isCCTurn ? 'text-purple-500' : isQclawTurn ? 'text-orange-500' : 'text-gc-primary';
  const replyBorder = isCCTurn ? 'border-purple-300/50' : isQclawTurn ? 'border-orange-300/50' : 'border-blue-300/50';
  const replyLabelColor = isCCTurn ? 'text-purple-400/60' : isQclawTurn ? 'text-orange-400/60' : 'text-blue-400/60';

  const [showDetails, setShowDetails] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [expandedPrompt, setExpandedPrompt] = useState(false);
  const [expandedReplies, setExpandedReplies] = useState({});
  const toggleReply = (i) => setExpandedReplies(v => ({ ...v, [i]: !v[i] }));

  const promptText = turn.userPrompt?.text || '';
  const hasMorePrompt = promptText.includes('\n') ? promptText.split('\n').filter(l => l.trim()).length > 2 : promptText.length > 160;

  return (
    <div className="px-6 py-4 hover:bg-gc-border/10 transition-colors">

      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {isInProgress
            ? <HourglassIcon size={16} className="text-gc-warning animate-pulse" />
            : <BotIcon size={16} className={botColor} />
          }
          <span className={`text-xs font-semibold rounded-full px-2 py-0.5 border ${pill}`}>
            {pillLabel}
          </span>
          {toolCalls.length > 0 && (() => {
            const tools = toolCalls.filter(tc => tc.type !== 'claude-code-text');
            const texts = toolCalls.length - tools.length;
            const parts = [summarizeToolCalls(tools, t), texts > 0 ? t('turnItem.messages', { count: texts, plural: texts !== 1 ? 's' : '' }) : ''].filter(Boolean);
            return parts.length > 0 ? (
              <span className="text-xs text-gc-text-dim bg-gc-border/40 px-2 py-0.5 rounded">
                {parts.join(', ')}
              </span>
            ) : null;
          })()}
          {riskLevel && !isContext && (
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${riskLevel.color}`}>
              {riskLevel.label}
            </span>
          )}
          {isInProgress && (
            <span className="text-xs text-gc-warning">{t('turnItem.working')}</span>
          )}
        </div>
        {ts && <span className="text-xs text-gc-text-dim whitespace-nowrap">{formatTime(ts)}</span>}
      </div>

      {/* ── User prompt bubble (when available — CC only for now) ── */}
      {promptText && (
        <div className="mb-3 flex justify-end">
          <div
            className={`max-w-[85%] bg-gc-primary/10 border border-gc-primary/20 rounded-xl rounded-tr-sm px-3 py-2 ${hasMorePrompt ? 'cursor-pointer' : 'cursor-default'}`}
            onClick={() => hasMorePrompt && setExpandedPrompt(v => !v)}
          >
            <p className={`text-xs text-gc-text leading-relaxed whitespace-pre-wrap ${!expandedPrompt && hasMorePrompt ? 'line-clamp-2' : ''}`}>
              {promptText}
            </p>
            {hasMorePrompt && !expandedPrompt && (
              <span className="text-blue-400 text-[10px] mt-1 block select-none">show more ▼</span>
            )}
            {hasMorePrompt && expandedPrompt && (
              <span className="text-blue-400 text-[10px] mt-1 block select-none">show less ▲</span>
            )}
          </div>
        </div>
      )}

      {/* ── Tool calls + intermediate text ── */}
      {toolCalls.length > 0 && (() => {
        const actualTools = toolCalls.filter(tc => tc.type !== 'claude-code-text');
        const textCount = toolCalls.length - actualTools.length;
        const label = [
          actualTools.length > 0 ? t('turnItem.toolCalls', { count: actualTools.length, plural: language === 'en' && actualTools.length !== 1 ? 's' : '' }) : '',
          textCount > 0 ? t('turnItem.messages', { count: textCount, plural: language === 'en' && textCount !== 1 ? 's' : '' }) : '',
        ].filter(Boolean).join(', ');
        return (
        <div className="mb-3">
          <button
            onClick={() => setShowDetails(v => !v)}
            className="text-xs text-gc-text-dim hover:text-gc-text transition-colors flex items-center gap-1 mb-2"
          >
            <span>{showDetails ? '▼' : '▶'}</span>
            <span>{label}</span>
          </button>
          {showDetails && (
            <div className="space-y-2">
              {toolCalls.map((tc, i) =>
                tc.type === 'claude-code-text'
                  ? <IntermediateText key={tc.id || i} text={tc.text} />
                  : <ToolCallRow key={tc.id || i} event={tc} />
              )}
            </div>
          )}
        </div>
        );
      })()}

      {/* ── Agent replies ── */}
      {agentReplies.map((reply, i) => (
        <div key={reply.id || i} className={`border-l-2 ${replyBorder} pl-3 mb-2`}>
          {agentReplies.length > 1 && (
            <span className={`text-[10px] font-mono mb-1 block ${replyLabelColor}`}>
              {reply.isFinal ? t('turnItem.final') : t('turnItem.intermediate')}
            </span>
          )}
          <ReplyText
            text={reply.text}
            expanded={!!expandedReplies[i]}
            onToggle={() => toggleReply(i)}
          />
        </div>
      ))}

      {/* ── Security Analysis (OpenClaw only) ── */}
      {!isCCTurn && !isContext && parentSafeguard?.riskScore != null && (
        <div className="mt-1">
          <button
            onClick={() => setShowAnalysis(!showAnalysis)}
            className="text-xs text-gc-primary hover:text-gc-primary/80 transition-colors flex items-center space-x-1"
          >
            <span>{showAnalysis ? '▼' : '▶'}</span>
            <span className="inline-flex items-center gap-1">
              <GuardClawLogo size={14} /> {t('analysis.securityAnalysis')} ({parentSafeguard?.category || 'general'})
            </span>
          </button>

          {showAnalysis && (
            <div className="mt-2 ml-4 space-y-2 text-sm bg-gc-primary/5 p-3 rounded border border-gc-primary/20">
              <div className="flex items-center space-x-2">
                <GuardClawLogo size={16} />
                <span className="text-gc-primary font-semibold">{t('analysis.securityAnalysis')}</span>
              </div>
              <div>
                <span className="text-gc-text-dim">{t('analysis.verdict')} </span>
                <span className="font-medium">
                  {parentSafeguard.riskScore <= 3 ? t('analysis.safe')
                    : parentSafeguard.riskScore <= 7 ? t('analysis.warning')
                    : parentSafeguard.verdict === 'pass-through' ? t('analysis.flagged') : t('analysis.blockedLabel')}
                </span>
              </div>
              {parentSafeguard.category && (
                <div><span className="text-gc-text-dim">{t('analysis.category')} </span>{parentSafeguard.category}</div>
              )}
              {parentSafeguard.reasoning && (
                <div>
                  <span className="text-gc-text-dim">{t('analysis.reasoning')}</span>
                  <p className="mt-1 bg-gc-bg/50 p-2 rounded text-sm">{parentSafeguard.reasoning}</p>
                </div>
              )}
              {parentSafeguard.concerns?.length > 0 && (
                <div>
                  <span className="text-gc-text-dim">{t('analysis.concerns')}</span>
                  <ul className="mt-1 list-disc list-inside">
                    {parentSafeguard.concerns.map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                </div>
              )}
              {parentSafeguard.allowed !== undefined && (
                <div>
                  <span className="text-gc-text-dim">{t('analysis.action')} </span>
                  <span className={`font-medium ${parentSafeguard.allowed ? 'text-gc-safe' : 'text-gc-danger'}`}>
                    {parentSafeguard.allowed ? t('analysis.allowed') : t('analysis.blockedAction')}
                  </span>
                </div>
              )}
              {parentSafeguard.memory && (
                <MemoryHint
                  memory={parentSafeguard.memory}
                  adjustment={parentSafeguard.memoryAdjustment}
                  originalScore={parentSafeguard.originalRiskScore}
                  currentScore={parentSafeguard.riskScore}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- UserMessageBubble: incoming user message in the timeline ---------- */
function UserMessageBubble({ event }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const content = event.content || '';
  const from = event.from || event.channelId || 'user';
  const hasMore = content.includes('\n')
    ? content.split('\n').filter(l => l.trim()).length > 3
    : content.length > 200;

  return (
    <div className="px-6 py-3 hover:bg-gc-border/5 transition-colors border-l-2 border-blue-500/50">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center space-x-2 mb-1.5">
            <span className="text-lg leading-none">💬</span>
            <span className="text-xs font-semibold text-blue-400">{t('turnItem.userMessage')}</span>
            {from && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-mono">
                {from}
              </span>
            )}
          </div>
          {content && (
            <div
              className={`text-sm text-gc-text whitespace-pre-wrap break-words ${hasMore ? 'cursor-pointer' : ''}`}
              onClick={() => hasMore && setExpanded(v => !v)}
            >
              <p className={!expanded && hasMore ? 'line-clamp-3' : ''}>{content}</p>
              {hasMore && !expanded && (
                <span className="text-blue-400 text-xs mt-1 block select-none">show more ▼</span>
              )}
              {hasMore && expanded && (
                <span className="text-blue-400 text-xs mt-1 block select-none">show less ▲</span>
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

/* ---------- AgentReplyBubble: outgoing agent reply in the timeline ---------- */
function AgentReplyBubble({ event }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const content = event.content || '';
  const to = event.to || '';
  const hasMore = content.includes('\n')
    ? content.split('\n').filter(l => l.trim()).length > 3
    : content.length > 200;

  return (
    <div className="px-6 py-3 hover:bg-gc-border/5 transition-colors border-l-2 border-green-500/50">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center space-x-2 mb-1.5">
            <span className="text-lg leading-none">🤖</span>
            <span className="text-xs font-semibold text-green-400">{t('turnItem.agentReply')}</span>
            {to && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/20 text-green-300 font-mono">
                → {to}
              </span>
            )}
          </div>
          {content && (
            <div
              className={`text-sm text-gc-text-dim whitespace-pre-wrap break-words ${hasMore ? 'cursor-pointer' : ''}`}
              onClick={() => hasMore && setExpanded(v => !v)}
            >
              <p className={!expanded && hasMore ? 'line-clamp-3' : ''}>{content}</p>
              {hasMore && !expanded && (
                <span className="text-blue-400 text-xs mt-1 block select-none">show more ▼</span>
              )}
              {hasMore && expanded && (
                <span className="text-blue-400 text-xs mt-1 block select-none">show less ▲</span>
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

function TurnItem({ turn }) {
  const { parent, toolCalls } = turn;

  // ── User message turn ──
  if (turn.isUserMessage && parent) {
    return <UserMessageBubble event={parent} />;
  }

  // ── Agent reply turn ──
  if (turn.isAgentReply && parent) {
    return <AgentReplyBubble event={parent} />;
  }

  // ── Agent turns: CC (isCCTurn) + OC orphan (no parent) + OC full turn (has parent + tools) ──
  if (turn.isCCTurn || toolCalls.length > 0) {
    return <AgentTurnItem turn={turn} />;
  }

  // ── Standalone: chat-update/chat-message with no tool calls ──
  if (!parent) return null; // shouldn't happen
  const isChat = parent.type === 'chat-update' || parent.type === 'chat-message';
  if (isChat || parent.safeguard?.isContext) {
    return <ChatContextBubble event={parent} />;
  }
  return <StandaloneEvent event={parent} />;
}

/* ---------- ChatContextBubble: conversation message shown as context, not a security event ---------- */
function ChatContextBubble({ event }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const content = event.summary || event.description || '';
  const isFinal = event.subType === 'final' || event.type === 'chat-message';
  const hasMore = content.includes('\n') ? content.split('\n').filter(l => l.trim()).length > 2 : content.length > 100;

  return (
    <div className="px-6 py-3 hover:bg-gc-border/5 transition-colors border-l-2 border-blue-400/30">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center space-x-2 mb-1">
            <span className="text-xs font-medium text-blue-500 dark:text-blue-400">
              {isFinal ? <><BotIcon size={12} className="inline mr-1" /> {t('turnItem.agent')}</> : <><MessageIcon size={12} className="inline mr-1" /> {t('turnItem.chat')}</>}
            </span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
              {t('turnItem.context')}
            </span>
          </div>
          {content && (
            <div
              className={`text-sm text-gc-text-dim whitespace-pre-wrap break-words ${hasMore ? 'cursor-pointer' : 'cursor-default'}`}
              onClick={() => hasMore && setExpanded(!expanded)}
            >
              <p className={!expanded && hasMore ? 'line-clamp-2' : ''}>{content}</p>
              {hasMore && !expanded && (
                <span className="text-blue-400 text-xs mt-1 block select-none">show more ▼</span>
              )}
              {hasMore && expanded && (
                <span className="text-blue-400 text-xs mt-1 block select-none">show less ▲</span>
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
  const { t } = useI18n();
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [expandedContent, setExpandedContent] = useState(false);
  const riskLevel = getRiskLevel(event.safeguard?.riskScore, event.safeguard?.pending, event.safeguard?.verdict);
  const type = event.type || 'unknown';
  const tool = event.tool || event.subType || '';
  const content = event.command || event.description || event.summary || '';
  const hasMoreContent = content.includes('\n') ? content.split('\n').filter(l => l.trim()).length > 2 : content.length > 100;

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
              <span className="text-xs px-2 py-1 rounded bg-gc-text-dim/20 text-gc-text-dim">{t('eventItem.aborted')}</span>
            )}
            {riskLevel && (
              <span className={`text-xs px-2 py-1 rounded font-medium ${riskLevel.color}`}>
                {riskLevel.label}
              </span>
            )}
          </div>

          {content && (
            <div
              className={`mb-3 ${hasMoreContent ? 'cursor-pointer' : 'cursor-default'}`}
              onClick={() => hasMoreContent && setExpandedContent(v => !v)}
            >
              <code className="text-sm text-gc-text-dim bg-gc-bg px-2 py-1 rounded inline-block max-w-full break-words whitespace-pre-wrap">
                <span className={!expandedContent && hasMoreContent ? 'line-clamp-2 block' : ''}>{content}</span>
              </code>
              {hasMoreContent && !expandedContent && (
                <span className="text-blue-400 text-xs mt-1 block select-none">show more ▼</span>
              )}
              {hasMoreContent && expandedContent && (
                <span className="text-blue-400 text-xs mt-1 block select-none">show less ▲</span>
              )}
            </div>
          )}

          {event.safeguard?.riskScore != null && (
            <button
              onClick={() => setShowAnalysis(!showAnalysis)}
              className="text-xs text-gc-primary hover:text-gc-primary/80 transition-colors flex items-center space-x-1"
            >
              <span>{showAnalysis ? '▼' : '▶'}</span>
              <span className='inline-flex items-center gap-1'><GuardClawLogo size={14} /> {t('analysis.securityAnalysis')} ({event.safeguard?.category || 'general'})</span>
            </button>
          )}

          {showAnalysis && event.safeguard && (
            <div className="mt-3 ml-4 space-y-2 text-sm bg-gc-primary/5 p-3 rounded border border-gc-primary/20">
              <div className="flex items-center space-x-2">
                <GuardClawLogo size={16} />
                <span className="text-gc-primary font-semibold">{t('analysis.securityAnalysis')}</span>
              </div>
              <div><span className="text-gc-text-dim">{t('analysis.verdict')}</span><span className="ml-2 font-medium">{event.safeguard.riskScore <= 3 ? t('analysis.safe') : event.safeguard.riskScore <= 7 ? t('analysis.warning') : event.safeguard.verdict === 'pass-through' ? t('analysis.flagged') : t('analysis.blockedLabel')}</span></div>
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
