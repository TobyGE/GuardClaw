import { useState, useEffect } from 'react';

function ApprovalItem({ item, onApprove, onDeny }) {
  const [expanded, setExpanded] = useState(false);

  const score = item.riskScore || 0;
  const scoreColor = score >= 9 ? 'text-red-400' : 'text-orange-400';
  const borderColor = score >= 9 ? 'border-red-500/60' : 'border-orange-500/60';
  const bgColor = score >= 9 ? 'bg-red-950/40' : 'bg-orange-950/40';
  const lines = (item.displayInput || '').split('\n');
  const isLong = lines.length > 6;
  const shownContent = expanded ? item.displayInput : lines.slice(0, 6).join('\n');

  return (
    <div className={`${bgColor} border ${borderColor} rounded-xl overflow-hidden shadow-xl`}>
      {/* Header bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-black/20 border-b border-white/5">
        <span className="text-base">🛑</span>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-xs font-semibold text-white/90 uppercase tracking-wide">Blocked</span>
          <span className="text-xs bg-white/10 text-white/60 px-2 py-0.5 rounded-full">
            {item.originalToolName || item.toolName}
          </span>
          <span className="text-xs text-white/40">from</span>
          <span className="text-xs bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded-full font-medium">
            Claude Code
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-sm font-bold font-mono ${scoreColor}`}>
            {score}<span className="text-white/30 text-xs font-normal">/10</span>
          </span>
          <span className="text-xs text-white/30">{item.elapsed}s ago</span>
        </div>
      </div>

      {/* Command block */}
      <div className="px-4 pt-3 pb-2">
        <div className="bg-black/30 rounded-lg border border-white/5 p-3">
          <pre className={`text-xs text-green-300 font-mono whitespace-pre-wrap break-all overflow-y-auto ${expanded ? 'max-h-64' : 'max-h-24'}`}>
            {shownContent}
          </pre>
          {isLong && (
            <button
              onClick={() => setExpanded(v => !v)}
              className="text-xs text-white/40 hover:text-white/70 mt-1.5 transition-colors"
            >
              {expanded ? '▲ 收起' : `▼ 展开全部 (${lines.length} 行)`}
            </button>
          )}
        </div>

        {/* Reason */}
        {item.reason && (
          <div className="flex items-start gap-1.5 mt-2.5">
            <span className="text-xs text-white/30 shrink-0 mt-0.5">Why:</span>
            <span className="text-xs text-white/50 leading-relaxed">{item.reason}</span>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 px-4 py-3 border-t border-white/5">
        <button
          onClick={() => onApprove(item.id)}
          className="flex-1 py-2 bg-emerald-600/80 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition-colors"
        >
          ✓ Approve
        </button>
        <button
          onClick={() => onApprove(item.id, true)}
          className="px-3 py-2 bg-emerald-900/60 hover:bg-emerald-800/80 text-emerald-300 text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
        >
          ✓ Always
        </button>
        <button
          onClick={() => onDeny(item.id)}
          className="flex-1 py-2 bg-red-600/80 hover:bg-red-500 text-white text-xs font-semibold rounded-lg transition-colors"
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
    <div className="mx-4 mt-3 space-y-2">
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
