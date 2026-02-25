import { useState, useEffect, useMemo } from 'react';
import StatCard from './StatCard';

function ConfidenceBar({ value }) {
  // value: -1 to +1
  const pct = ((value + 1) / 2) * 100; // 0-100
  const color = value > 0.5 ? 'bg-gc-safe' : value > 0 ? 'bg-blue-500' : value > -0.3 ? 'bg-gc-warning' : 'bg-gc-danger';
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-2 rounded-full bg-gc-border overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gc-text-secondary w-10">{value.toFixed(2)}</span>
    </div>
  );
}

function ActionBadge({ action }) {
  const styles = {
    'auto-approve': 'bg-gc-safe/20 text-green-400 border-gc-safe/30',
    'auto-deny': 'bg-gc-danger/20 text-red-400 border-gc-danger/30',
    'ask': 'bg-gc-warning/20 text-yellow-400 border-gc-warning/30',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${styles[action] || styles.ask}`}>
      {action}
    </span>
  );
}

function relativeTime(ts) {
  if (!ts) return 'Never';
  const diff = Date.now() - ts;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function MemoryPage() {
  const [stats, setStats] = useState(null);
  const [patterns, setPatterns] = useState([]);
  const [sortKey, setSortKey] = useState('lastSeen');
  const [sortDir, setSortDir] = useState('desc');
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const [statsRes, patternsRes] = await Promise.all([
        fetch('/api/memory/stats'),
        fetch('/api/memory/patterns'),
      ]);
      if (statsRes.ok) setStats(await statsRes.json());
      if (patternsRes.ok) {
        const data = await patternsRes.json();
        setPatterns(data.patterns || []);
      }
    } catch (err) {
      console.error('Failed to fetch memory data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const sortedPatterns = useMemo(() => {
    const sorted = [...patterns].sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (typeof av === 'string') av = av.toLowerCase();
      if (typeof bv === 'string') bv = bv.toLowerCase();
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [patterns, sortKey, sortDir]);

  const handleReset = async () => {
    try {
      await fetch('/api/memory/reset', { method: 'POST' });
      setPatterns([]);
      setStats({ totalDecisions: 0, totalPatterns: 0, approves: 0, denies: 0, approveRate: '0', autoApproveCount: 0 });
      setShowResetConfirm(false);
    } catch (err) {
      console.error('Failed to reset memory:', err);
    }
  };

  const SortHeader = ({ label, field, className = '' }) => (
    <th
      className={`px-4 py-3 text-left text-xs font-medium text-gc-text-secondary uppercase tracking-wider cursor-pointer hover:text-gc-text transition-colors select-none ${className}`}
      onClick={() => handleSort(field)}
    >
      {label}
      {sortKey === field && (
        <span className="ml-1">{sortDir === 'asc' ? '\u25B2' : '\u25BC'}</span>
      )}
    </th>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-gc-text-secondary">Loading memory data...</div>
      </div>
    );
  }

  return (
    <div>
      {/* Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          title="TOTAL DECISIONS"
          value={stats?.totalDecisions || 0}
          color="text-gc-text"
        />
        <StatCard
          title="PATTERNS"
          value={stats?.totalPatterns || 0}
          color="text-gc-primary"
        />
        <StatCard
          title="APPROVE RATE"
          value={`${stats?.approveRate || 0}%`}
          color="text-gc-safe"
        />
        <StatCard
          title="AUTO-APPROVE"
          value={stats?.autoApproveCount || 0}
          color="text-blue-400"
        />
      </div>

      {/* Patterns Table */}
      <div className="bg-gc-card rounded-lg border border-gc-border overflow-hidden">
        <div className="px-6 py-4 border-b border-gc-border flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gc-text">Learned Patterns</h2>
          <button
            onClick={() => setShowResetConfirm(true)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gc-danger/20 text-red-400 border border-gc-danger/30 hover:bg-gc-danger/30 transition-colors"
          >
            Reset Memory
          </button>
        </div>

        {patterns.length === 0 ? (
          <div className="px-6 py-12 text-center text-gc-text-secondary">
            No patterns learned yet. Approve or deny some tool calls to build memory.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gc-bg">
                <tr>
                  <SortHeader label="Pattern" field="pattern" />
                  <SortHeader label="Tool" field="toolName" />
                  <SortHeader label="Approves" field="approveCount" />
                  <SortHeader label="Denies" field="denyCount" />
                  <SortHeader label="Confidence" field="confidence" />
                  <SortHeader label="Action" field="suggestedAction" />
                  <SortHeader label="Last Seen" field="lastSeen" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gc-border">
                {sortedPatterns.map((p) => (
                  <tr key={p.pattern} className="hover:bg-gc-bg/50 transition-colors">
                    <td className="px-4 py-3 text-sm text-gc-text font-mono max-w-xs truncate" title={p.pattern}>
                      {p.pattern}
                    </td>
                    <td className="px-4 py-3 text-sm text-gc-text-secondary">{p.toolName}</td>
                    <td className="px-4 py-3 text-sm text-gc-safe font-medium">{p.approveCount}</td>
                    <td className="px-4 py-3 text-sm text-gc-danger font-medium">{p.denyCount}</td>
                    <td className="px-4 py-3"><ConfidenceBar value={p.confidence} /></td>
                    <td className="px-4 py-3"><ActionBadge action={p.suggestedAction} /></td>
                    <td className="px-4 py-3 text-sm text-gc-text-secondary whitespace-nowrap">{relativeTime(p.lastSeen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Reset Confirmation Dialog */}
      {showResetConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowResetConfirm(false)}>
          <div className="bg-gc-card rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gc-border">
              <h3 className="text-lg font-bold text-gc-text">Reset All Memory?</h3>
            </div>
            <div className="px-6 py-4">
              <p className="text-sm text-gc-text-secondary">
                This will permanently delete all {stats?.totalDecisions || 0} decisions and {stats?.totalPatterns || 0} learned patterns. This action cannot be undone.
              </p>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gc-border">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-gc-text-secondary hover:text-gc-text hover:bg-gc-border transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleReset}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-gc-danger text-white hover:bg-red-600 transition-colors"
              >
                Reset Memory
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MemoryPage;
