import GuardClawLogo from './GuardClawLogo';
import { MonitorIcon } from './icons';
import { useState, useEffect } from 'react';

const Card = ({ children, className = '' }) => (
  <div className={`rounded-xl border border-gc-border bg-gc-bg p-5 ${className}`}>{children}</div>
);

const Label = ({ children, hint }) => (
  <div className="mb-2">
    <span className="text-sm font-semibold text-gc-text">{children}</span>
    {hint && <span className="ml-2 text-xs text-gc-text-dim">{hint}</span>}
  </div>
);

function BlockingModal({ isOpen, onClose, currentStatus }) {
  const [status, setStatus] = useState(null);
  const [whitelistInput, setWhitelistInput] = useState('');
  const [blacklistInput, setBlacklistInput] = useState('');
  const [message, setMessage] = useState('');
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    if (isOpen) { fetchStatus(); setMessage(''); }
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
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: enable }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.needsGatewayRestart) {
          setMessage('Restarting gateway… page will reload shortly.');
          setTimeout(() => window.location.reload(), 2000);
        } else {
          await fetchStatus();
          setMessage(enable ? 'Active blocking enabled' : 'Switched to monitor-only mode');
          setTimeout(() => setMessage(''), 3000);
        }
      }
    } catch (e) {
      setMessage('Failed: ' + e.message);
    } finally { setToggling(false); }
  };

  const addPattern = async (type, value, clear) => {
    if (!value.trim()) return;
    try {
      const res = await fetch(`/api/blocking/${type}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pattern: value.trim() }),
      });
      if (res.ok) { clear(''); fetchStatus(); }
    } catch {}
  };

  const removePattern = async (type, pattern) => {
    try {
      const res = await fetch(`/api/blocking/${type}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pattern }),
      });
      if (res.ok) fetchStatus();
    } catch {}
  };

  if (!isOpen) return null;
  const isActive = status?.active;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-gc-card rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gc-border">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm ${
              isActive ? 'bg-gradient-to-br from-red-500 to-orange-600' : 'bg-gradient-to-br from-gray-500 to-gray-600'
            }`}>
              {isActive ? <GuardClawLogo size={18} /> : <MonitorIcon size={18} />}
            </div>
            <div>
              <h2 className="text-lg font-bold text-gc-text">Protection Mode</h2>
              <p className="text-xs text-gc-text-dim">
                {isActive ? 'Active blocking — high-risk tools require approval' : 'Monitor only — all tools run freely'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-gc-text-dim hover:text-gc-text hover:bg-gc-border transition-colors">✕</button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

          {message && (
            <div className="flex items-center gap-2.5 px-4 py-3 rounded-lg text-sm font-medium bg-gc-primary/10 text-gc-primary border border-gc-primary/20">
              <span>ℹ️</span><span>{message}</span>
            </div>
          )}

          {/* Mode selector */}
          <Card>
            <Label>Blocking Mode</Label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => !isActive && toggleBlocking(true)}
                disabled={toggling}
                className={`flex items-center gap-3 p-4 rounded-lg border-2 transition-all text-left ${
                  isActive
                    ? 'border-red-500 bg-red-500/10 shadow-sm shadow-red-500/10'
                    : 'border-gc-border hover:border-red-500/30 bg-gc-card'
                }`}
              >
                <GuardClawLogo size={28} />
                <div>
                  <div className={`text-sm font-semibold ${isActive ? 'text-red-400' : 'text-gc-text-secondary'}`}>Active Blocking</div>
                  <div className="text-xs text-gc-text-dim mt-0.5">Intercept & require approval</div>
                </div>
              </button>

              <button
                onClick={() => isActive && toggleBlocking(false)}
                disabled={toggling}
                className={`flex items-center gap-3 p-4 rounded-lg border-2 transition-all text-left ${
                  !isActive
                    ? 'border-gc-primary bg-gc-primary/10 shadow-sm shadow-gc-primary/10'
                    : 'border-gc-border hover:border-gc-primary/30 bg-gc-card'
                }`}
              >
                <MonitorIcon size={24} />
                <div>
                  <div className={`text-sm font-semibold ${!isActive ? 'text-gc-primary' : 'text-gc-text-secondary'}`}>Monitor Only</div>
                  <div className="text-xs text-gc-text-dim mt-0.5">Log & score, never block</div>
                </div>
              </button>
            </div>

            {isActive && status?.thresholds && (
              <div className="mt-4 flex items-center justify-center gap-4 text-xs text-gc-text-dim">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-gc-safe"></span>
                  Auto-allow ≤ {status.thresholds.autoAllow}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-gc-warning"></span>
                  Review {status.thresholds.autoAllow + 1}–{status.thresholds.autoBlock - 1}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-gc-danger"></span>
                  Auto-block ≥ {status.thresholds.autoBlock}
                </span>
              </div>
            )}
          </Card>

          {/* Override Patterns */}
          <Card>
            <Label hint="glob patterns: * any chars, ? single char">Override Rules</Label>

            {/* Whitelist */}
            <div className="mb-5">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-5 h-5 rounded-full bg-gc-safe/20 flex items-center justify-center text-xs text-gc-safe">✓</span>
                <span className="text-sm font-medium text-gc-text">Always Allow</span>
              </div>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={whitelistInput}
                  onChange={e => setWhitelistInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addPattern('whitelist', whitelistInput, setWhitelistInput)}
                  placeholder="e.g. git status, ls *"
                  className="flex-1 px-3.5 py-2 text-sm bg-gc-card border border-gc-border rounded-lg text-gc-text placeholder-gc-text-dim focus:outline-none focus:ring-2 focus:ring-gc-safe/40 focus:border-gc-safe transition-all"
                />
                <button
                  onClick={() => addPattern('whitelist', whitelistInput, setWhitelistInput)}
                  className="px-4 py-2 text-sm font-medium bg-gc-safe/10 text-gc-safe border border-gc-safe/30 rounded-lg hover:bg-gc-safe/20 transition-colors"
                >
                  Add
                </button>
              </div>
              {status?.whitelist?.length > 0 && (
                <div className="space-y-1.5">
                  {status.whitelist.map((p, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2 bg-gc-card rounded-lg border border-gc-border group">
                      <code className="text-xs text-gc-text font-mono">{p}</code>
                      <button onClick={() => removePattern('whitelist', p)} className="text-xs text-gc-text-dim hover:text-gc-danger opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Blacklist */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-5 h-5 rounded-full bg-gc-danger/20 flex items-center justify-center text-xs text-gc-danger">✕</span>
                <span className="text-sm font-medium text-gc-text">Always Block</span>
              </div>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={blacklistInput}
                  onChange={e => setBlacklistInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addPattern('blacklist', blacklistInput, setBlacklistInput)}
                  placeholder="e.g. rm -rf *, sudo *"
                  className="flex-1 px-3.5 py-2 text-sm bg-gc-card border border-gc-border rounded-lg text-gc-text placeholder-gc-text-dim focus:outline-none focus:ring-2 focus:ring-gc-danger/40 focus:border-gc-danger transition-all"
                />
                <button
                  onClick={() => addPattern('blacklist', blacklistInput, setBlacklistInput)}
                  className="px-4 py-2 text-sm font-medium bg-gc-danger/10 text-gc-danger border border-gc-danger/30 rounded-lg hover:bg-gc-danger/20 transition-colors"
                >
                  Add
                </button>
              </div>
              {status?.blacklist?.length > 0 && (
                <div className="space-y-1.5">
                  {status.blacklist.map((p, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2 bg-gc-card rounded-lg border border-gc-border group">
                      <code className="text-xs text-gc-text font-mono">{p}</code>
                      <button onClick={() => removePattern('blacklist', p)} className="text-xs text-gc-text-dim hover:text-gc-danger opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-4 border-t border-gc-border bg-gc-card">
          <button onClick={onClose} className="px-4 py-2.5 rounded-lg text-sm font-medium text-gc-text-dim hover:text-gc-text hover:bg-gc-border transition-colors">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export default BlockingModal;
