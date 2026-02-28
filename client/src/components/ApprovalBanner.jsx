import { useState, useEffect } from 'react';

export default function ApprovalBanner() {
  const [pending, setPending] = useState([]);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/approvals/pending');
        const data = await res.json();
        setPending(data.pending || []);
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, []);

  // Also listen for SSE events to update faster
  useEffect(() => {
    const evtSource = new EventSource('/api/events');
    evtSource.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        if (event.type === 'approval-pending' || event.type === 'approval-resolved') {
          // Re-fetch on any approval event
          fetch('/api/approvals/pending')
            .then(r => r.json())
            .then(data => setPending(data.pending || []))
            .catch(() => {});
        }
      } catch {}
    };
    return () => evtSource.close();
  }, []);

  const handleApprove = async (id, alwaysApprove = false) => {
    try {
      await fetch(`/api/approvals/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alwaysApprove }),
      });
      setPending(prev => prev.filter(p => p.id !== id));
    } catch {}
  };

  const handleDeny = async (id) => {
    try {
      await fetch(`/api/approvals/${id}/deny`, { method: 'POST' });
      setPending(prev => prev.filter(p => p.id !== id));
    } catch {}
  };

  if (pending.length === 0) return null;

  return (
    <div className="mx-4 mt-4 space-y-3">
      {pending.map(item => (
        <div key={item.id} className="bg-gradient-to-r from-red-900/30 to-orange-900/30 border border-red-500/40 rounded-xl p-4 shadow-lg animate-pulse-slow">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-red-400 text-lg">🛑</span>
                <span className="text-sm font-bold text-red-300">Claude Code — Approval Required</span>
                <span className="text-xs bg-red-500/20 text-red-300 px-2 py-0.5 rounded-full font-mono">
                  Score: {item.riskScore}/10
                </span>
                <span className="text-xs text-gc-text-dim">
                  {item.elapsed}s ago
                </span>
              </div>
              <div className="text-sm text-gc-text mb-1">
                <span className="text-gc-text-dim">Tool:</span>{' '}
                <code className="text-orange-300">{item.originalToolName || item.toolName}</code>
              </div>
              <div className="text-xs text-gc-text-dim font-mono bg-gc-bg/50 rounded px-2 py-1 break-all max-h-20 overflow-y-auto">
                {item.displayInput}
              </div>
              {item.reason && (
                <div className="text-xs text-red-300/80 mt-1">
                  Why: {item.reason}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2 shrink-0">
              <button
                onClick={() => handleApprove(item.id)}
                className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                ✅ Approve
              </button>
              <button
                onClick={() => handleApprove(item.id, true)}
                className="px-4 py-2 bg-green-800 hover:bg-green-700 text-green-200 text-xs font-medium rounded-lg transition-colors"
              >
                ✅ Always Allow
              </button>
              <button
                onClick={() => handleDeny(item.id)}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                ❌ Deny
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
