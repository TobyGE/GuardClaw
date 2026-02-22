import { useState, useEffect } from 'react';

function BlockingModal({ isOpen, onClose, currentStatus }) {
  const [status, setStatus] = useState(null);
  const [whitelistInput, setWhitelistInput] = useState('');
  const [blacklistInput, setBlacklistInput] = useState('');
  const [message, setMessage] = useState('');
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchStatus();
      setMessage('');
    }
  }, [isOpen]);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/blocking/status');
      if (res.ok) setStatus(await res.json());
    } catch {}
  };

  const toggleBlocking = async (enable) => {
    if (toggling) return;
    setToggling(true);
    try {
      const res = await fetch('/api/blocking/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: enable }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.needsGatewayRestart) {
          setMessage('Restarting gateway… page will reload shortly.');
          setTimeout(() => window.location.reload(), 2000);
        } else {
          await fetchStatus();
        }
      }
    } catch (e) {
      setMessage('Failed: ' + e.message);
    } finally {
      setToggling(false);
    }
  };

  const addPattern = async (type, value, clear) => {
    if (!value.trim()) return;
    try {
      const res = await fetch(`/api/blocking/${type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pattern: value.trim() }),
      });
      if (res.ok) { clear(''); fetchStatus(); }
    } catch {}
  };

  const removePattern = async (type, pattern) => {
    try {
      const res = await fetch(`/api/blocking/${type}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pattern }),
      });
      if (res.ok) fetchStatus();
    } catch {}
  };

  if (!isOpen) return null;

  const isActive = status?.active;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-gc-card border border-gc-border rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{isActive ? '🚫' : '👀'}</span>
            <h2 className="text-xl font-bold text-gc-primary">Blocking Configuration</h2>
          </div>
          <button onClick={onClose} className="text-gc-muted hover:text-gc-text text-2xl leading-none">×</button>
        </div>

        <div className="px-6 pb-6 space-y-4">
          {message && (
            <div className="bg-blue-500/20 border border-blue-500/30 rounded-lg px-4 py-2 text-sm text-blue-400">
              {message}
            </div>
          )}

          {/* Mode selector */}
          <p className="text-sm text-gc-muted">
            Should GuardClaw actively block high-risk tool calls, or only monitor and report?
          </p>

          <div className="grid grid-cols-2 gap-3">
            {/* Active Blocking */}
            <button
              onClick={() => !isActive && toggleBlocking(true)}
              disabled={toggling}
              className={`rounded-lg p-4 text-left border transition-all ${
                isActive
                  ? 'bg-red-500/20 border-red-500/40 ring-1 ring-red-500/50'
                  : 'bg-gc-bg border-gc-border hover:border-red-500/30 hover:bg-red-500/10'
              }`}
            >
              <div className="font-semibold text-red-400 mb-1">
                🚫 Active Blocking
                {isActive && <span className="ml-2 text-xs font-normal opacity-70">(current)</span>}
              </div>
              <p className="text-xs text-gc-muted leading-relaxed">
                High-risk tool calls are intercepted and require your approval before running.
              </p>
            </button>

            {/* Monitor Only */}
            <button
              onClick={() => isActive && toggleBlocking(false)}
              disabled={toggling}
              className={`rounded-lg p-4 text-left border transition-all ${
                !isActive
                  ? 'bg-gray-500/20 border-gray-500/40 ring-1 ring-gray-500/50'
                  : 'bg-gc-bg border-gc-border hover:border-gray-500/30 hover:bg-gray-500/10'
              }`}
            >
              <div className="font-semibold text-gray-400 mb-1">
                👀 Monitor Only
                {!isActive && <span className="ml-2 text-xs font-normal opacity-70">(current)</span>}
              </div>
              <p className="text-xs text-gc-muted leading-relaxed">
                All tool calls run freely. GuardClaw logs and scores them but never blocks.
              </p>
            </button>
          </div>

          {isActive && status?.thresholds && (
            <p className="text-xs text-gc-muted text-center">
              Auto-allow ≤ {status.thresholds.autoAllow} &nbsp;·&nbsp; Approval required {status.thresholds.autoAllow + 1}–{status.thresholds.autoBlock - 1} &nbsp;·&nbsp; Auto-block ≥ {status.thresholds.autoBlock}
            </p>
          )}

          {/* Divider */}
          <div className="border-t border-gc-border pt-2">
            <p className="text-xs text-gc-muted mb-3 uppercase tracking-wide font-medium">Override Patterns</p>

            {/* Whitelist */}
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-semibold text-green-400">✅ Always Allow</span>
                <span className="text-xs text-gc-muted">(overrides risk score)</span>
              </div>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={whitelistInput}
                  onChange={e => setWhitelistInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addPattern('whitelist', whitelistInput, setWhitelistInput)}
                  placeholder="e.g. git status, ls *"
                  className="flex-1 px-3 py-1.5 text-sm bg-gc-bg border border-gc-border rounded-lg text-gc-text placeholder-gc-muted focus:outline-none focus:border-green-500/50"
                />
                <button
                  onClick={() => addPattern('whitelist', whitelistInput, setWhitelistInput)}
                  className="px-3 py-1.5 text-sm bg-green-500/20 text-green-400 border border-green-500/30 rounded-lg hover:bg-green-500/30"
                >
                  Add
                </button>
              </div>
              {status?.whitelist?.length > 0 && (
                <div className="space-y-1">
                  {status.whitelist.map((p, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-1.5 bg-gc-bg rounded-lg border border-gc-border">
                      <code className="text-xs text-gc-text">{p}</code>
                      <button onClick={() => removePattern('whitelist', p)} className="text-xs text-gc-muted hover:text-red-400">✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Blacklist */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-semibold text-red-400">🚫 Always Block</span>
                <span className="text-xs text-gc-muted">(overrides risk score)</span>
              </div>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={blacklistInput}
                  onChange={e => setBlacklistInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addPattern('blacklist', blacklistInput, setBlacklistInput)}
                  placeholder="e.g. rm -rf *, sudo *"
                  className="flex-1 px-3 py-1.5 text-sm bg-gc-bg border border-gc-border rounded-lg text-gc-text placeholder-gc-muted focus:outline-none focus:border-red-500/50"
                />
                <button
                  onClick={() => addPattern('blacklist', blacklistInput, setBlacklistInput)}
                  className="px-3 py-1.5 text-sm bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/30"
                >
                  Add
                </button>
              </div>
              {status?.blacklist?.length > 0 && (
                <div className="space-y-1">
                  {status.blacklist.map((p, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-1.5 bg-gc-bg rounded-lg border border-gc-border">
                      <code className="text-xs text-gc-text">{p}</code>
                      <button onClick={() => removePattern('blacklist', p)} className="text-xs text-gc-muted hover:text-red-400">✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <p className="text-xs text-gc-muted text-center">
            Patterns support <code className="opacity-80">*</code> (any chars) and <code className="opacity-80">?</code> (single char)
          </p>
        </div>
      </div>
    </div>
  );
}

export default BlockingModal;
