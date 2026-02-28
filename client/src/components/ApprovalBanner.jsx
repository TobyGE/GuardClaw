import { useState, useEffect } from 'react';
import GuardClawLogo from './GuardClawLogo';

function ApprovalItem({ item, onApprove, onDeny }) {
  const [expanded, setExpanded] = useState(false);

  const score = item.riskScore || 0;
  const isHighRisk = score >= 8;
  const borderColor = isHighRisk ? 'border-l-gc-danger' : 'border-l-gc-warning';
  const scoreColor = isHighRisk ? 'text-gc-danger' : 'text-gc-warning';
  const scoreBg = isHighRisk ? 'bg-gc-danger/8 border-gc-danger/20' : 'bg-gc-warning/8 border-gc-warning/20';
  const labelColor = isHighRisk ? 'text-gc-danger' : 'text-gc-warning';

  // Command block color by tool
  const tool = item.toolName || '';
  const cmdBg = tool === 'exec' ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
    : (tool === 'write' || tool === 'edit') ? 'bg-sky-50 border-sky-200 text-sky-800'
    : 'bg-gc-bg border-gc-border text-gc-text';

  const lines = (item.displayInput || '').split('\n');
  const isLong = lines.length > 5;
  const shownContent = expanded ? item.displayInput : lines.slice(0, 5).join('\n');

  // Elapsed
  const elapsed = item.elapsed != null ? `${item.elapsed}s` : '';

  return (
    <div className={`bg-gc-card border border-gc-border border-l-[3px] ${borderColor} rounded-lg overflow-hidden`}>

      {/* Header */}
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-gc-border">
        <GuardClawLogo size={14} />
        <span className={`text-[10px] font-bold uppercase tracking-wider ${labelColor}`}>Blocked</span>
        <span className="text-xs text-gc-text-dim font-mono">{item.originalToolName || item.toolName}</span>
        <span className="text-gc-border text-xs">·</span>
        <span className="text-[10px] font-semibold text-purple-600 bg-purple-50 border border-purple-200 rounded-full px-2 py-0.5">
          Claude Code
        </span>
        <div className="flex-1" />
        <span className={`text-xs font-bold font-mono ${scoreColor} ${scoreBg} border rounded px-1.5 py-0.5`}>
          {score}/10
        </span>
        {elapsed && <span className="text-[10px] text-gc-text-dim">{elapsed}</span>}
      </div>

      {/* Command + Reason */}
      <div className="px-3.5 py-3 border-b border-gc-border space-y-2">
        {/* Label (file path for write/edit, "Command" for exec) */}
        <div className="text-[10px] font-medium text-gc-text-dim uppercase tracking-wider">
          {tool === 'exec' ? 'Command' : tool === 'read' ? 'File' : lines[0] || 'Input'}
        </div>

        {/* Content block */}
        <code className={`block text-xs font-mono leading-relaxed rounded-md border px-2.5 py-2 whitespace-pre-wrap break-all overflow-y-auto ${cmdBg} ${expanded ? 'max-h-48' : 'max-h-20'}`}>
          {tool === 'write' || tool === 'edit'
            ? (expanded ? lines.slice(1).join('\n') : lines.slice(1, 6).join('\n'))
            : shownContent}
        </code>

        {isLong && (
          <button
            onClick={() => setExpanded(v => !v)}
            className="text-[10px] text-gc-text-dim hover:text-gc-text transition-colors"
          >
            {expanded ? '▲ 收起' : `▼ 展开全部 (${lines.length} 行)`}
          </button>
        )}

        {/* Reason */}
        {item.reason && (
          <p className="text-[11px] text-gc-text-dim leading-relaxed">{item.reason}</p>
        )}
      </div>

      {/* Action buttons */}
      <div className="grid grid-cols-3">
        <button
          onClick={() => onApprove(item.id)}
          className="py-2.5 text-xs font-semibold text-gc-safe hover:bg-gc-safe/5 transition-colors border-r border-gc-border"
        >
          ✓ Approve
        </button>
        <button
          onClick={() => onApprove(item.id, true)}
          className="py-2.5 text-[11px] font-medium text-gc-text-dim hover:bg-gc-border/30 hover:text-gc-text transition-colors border-r border-gc-border"
        >
          Always Approve
        </button>
        <button
          onClick={() => onDeny(item.id)}
          className="py-2.5 text-xs font-semibold text-gc-danger hover:bg-gc-danger/5 transition-colors"
        >
          ✕ Deny
        </button>
      </div>
    </div>
  );
}

export default function ApprovalBanner() {
  const [pending, setPending] = useState([]);

  const fetchPending = () =>
    fetch('/api/approvals/pending')
      .then(r => r.json())
      .then(data => setPending(data.pending || []))
      .catch(() => {});

  useEffect(() => {
    fetchPending();
    const interval = setInterval(fetchPending, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const evtSource = new EventSource('/api/events');
    evtSource.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        if (event.type === 'approval-pending' || event.type === 'approval-resolved') fetchPending();
      } catch {}
    };
    return () => evtSource.close();
  }, []);

  const handleApprove = async (id, alwaysApprove = false) => {
    await fetch(`/api/approvals/${id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alwaysApprove }),
    }).catch(() => {});
    setPending(prev => prev.filter(p => p.id !== id));
  };

  const handleDeny = async (id) => {
    await fetch(`/api/approvals/${id}/deny`, { method: 'POST' }).catch(() => {});
    setPending(prev => prev.filter(p => p.id !== id));
  };

  if (pending.length === 0) return null;

  return (
    <div className="px-4 pt-3 pb-1 space-y-2">
      {pending.map(item => (
        <ApprovalItem
          key={item.id}
          item={item}
          onApprove={handleApprove}
          onDeny={handleDeny}
        />
      ))}
    </div>
  );
}
