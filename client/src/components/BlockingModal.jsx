import { useState, useEffect } from 'react';

function BlockingModal({ isOpen, onClose, currentStatus }) {
  const [status, setStatus] = useState(null);
  const [whitelistInput, setWhitelistInput] = useState('');
  const [blacklistInput, setBlacklistInput] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (isOpen) {
      fetchStatus();
    }
  }, [isOpen]);

  const fetchStatus = async () => {
    try {
      const response = await fetch('/api/blocking/status');
      if (response.ok) {
        const data = await response.json();
        setStatus(data);
      }
    } catch (error) {
      console.error('Failed to fetch blocking status:', error);
    }
  };

  const toggleBlocking = async () => {
    try {
      const response = await fetch('/api/blocking/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !status.enabled })
      });
      
      if (response.ok) {
        const data = await response.json();
        setMessage(data.message);
        fetchStatus();
      }
    } catch (error) {
      setMessage('Failed to toggle blocking: ' + error.message);
    }
  };

  const addToWhitelist = async () => {
    if (!whitelistInput.trim()) return;
    
    try {
      const response = await fetch('/api/blocking/whitelist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pattern: whitelistInput.trim() })
      });
      
      if (response.ok) {
        setWhitelistInput('');
        fetchStatus();
      }
    } catch (error) {
      setMessage('Failed to add whitelist: ' + error.message);
    }
  };

  const removeFromWhitelist = async (pattern) => {
    try {
      const response = await fetch('/api/blocking/whitelist', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pattern })
      });
      
      if (response.ok) {
        fetchStatus();
      }
    } catch (error) {
      setMessage('Failed to remove whitelist: ' + error.message);
    }
  };

  const addToBlacklist = async () => {
    if (!blacklistInput.trim()) return;
    
    try {
      const response = await fetch('/api/blocking/blacklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pattern: blacklistInput.trim() })
      });
      
      if (response.ok) {
        setBlacklistInput('');
        fetchStatus();
      }
    } catch (error) {
      setMessage('Failed to add blacklist: ' + error.message);
    }
  };

  const removeFromBlacklist = async (pattern) => {
    try {
      const response = await fetch('/api/blocking/blacklist', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pattern })
      });
      
      if (response.ok) {
        fetchStatus();
      }
    } catch (error) {
      setMessage('Failed to remove blacklist: ' + error.message);
    }
  };

  if (!isOpen || !status) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gc-card border border-gc-border rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-gc-card border-b border-gc-border px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gc-text">🛡️ Blocking Configuration</h2>
          <button
            onClick={onClose}
            className="text-gc-text-dim hover:text-gc-text text-2xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Message */}
          {message && (
            <div className="bg-blue-500/20 border border-blue-500/30 rounded-lg p-3 text-sm text-blue-400">
              {message}
            </div>
          )}

          {/* Toggle Blocking */}
          <div className="bg-gc-bg rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h3 className="text-lg font-semibold text-gc-text">Blocking Status</h3>
                <p className="text-sm text-gc-text-dim mt-1">
                  {status.active 
                    ? `🛡️ Active (${status.mode}): Auto-allow ≤${status.thresholds?.autoAllow}, Auto-block ≥${status.thresholds?.autoBlock}`
                    : '👀 Monitor Only - Commands are not blocked'
                  }
                </p>
              </div>
              <button
                onClick={toggleBlocking}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  status.enabled
                    ? 'bg-red-500 hover:bg-red-600 text-white'
                    : 'bg-green-500 hover:bg-green-600 text-white'
                }`}
              >
                {status.enabled ? 'Disable Blocking' : 'Enable Blocking'}
              </button>
            </div>
          </div>

          {/* Whitelist */}
          <div className="bg-gc-bg rounded-lg p-4">
            <h3 className="text-lg font-semibold text-gc-text mb-2">✅ Whitelist (Always Allow)</h3>
            <p className="text-sm text-gc-text-dim mb-3">
              Commands matching these patterns will always be allowed. Supports * (any chars) and ? (single char).
            </p>
            
            <div className="flex space-x-2 mb-3">
              <input
                type="text"
                value={whitelistInput}
                onChange={(e) => setWhitelistInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && addToWhitelist()}
                placeholder="e.g., ls *, git status, echo *"
                className="flex-1 px-3 py-2 bg-gc-card border border-gc-border rounded text-gc-text placeholder-gc-text-dim focus:outline-none focus:border-gc-primary"
              />
              <button
                onClick={addToWhitelist}
                className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded font-medium"
              >
                Add
              </button>
            </div>

            <div className="space-y-2">
              {status.whitelist.length === 0 ? (
                <div className="text-sm text-gc-text-dim italic">No whitelist patterns</div>
              ) : (
                status.whitelist.map((pattern, idx) => (
                  <div key={idx} className="flex items-center justify-between bg-gc-card px-3 py-2 rounded border border-gc-border">
                    <code className="text-sm text-gc-text">{pattern}</code>
                    <button
                      onClick={() => removeFromWhitelist(pattern)}
                      className="text-red-400 hover:text-red-300 text-sm font-medium"
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Blacklist */}
          <div className="bg-gc-bg rounded-lg p-4">
            <h3 className="text-lg font-semibold text-gc-text mb-2">🚫 Blacklist (Always Block)</h3>
            <p className="text-sm text-gc-text-dim mb-3">
              Commands matching these patterns will always be blocked. Supports * (any chars) and ? (single char).
            </p>
            
            <div className="flex space-x-2 mb-3">
              <input
                type="text"
                value={blacklistInput}
                onChange={(e) => setBlacklistInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && addToBlacklist()}
                placeholder="e.g., rm -rf *, sudo rm *, dd if=*"
                className="flex-1 px-3 py-2 bg-gc-card border border-gc-border rounded text-gc-text placeholder-gc-text-dim focus:outline-none focus:border-gc-primary"
              />
              <button
                onClick={addToBlacklist}
                className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded font-medium"
              >
                Add
              </button>
            </div>

            <div className="space-y-2">
              {status.blacklist.length === 0 ? (
                <div className="text-sm text-gc-text-dim italic">No blacklist patterns</div>
              ) : (
                status.blacklist.map((pattern, idx) => (
                  <div key={idx} className="flex items-center justify-between bg-gc-card px-3 py-2 rounded border border-gc-border">
                    <code className="text-sm text-gc-text">{pattern}</code>
                    <button
                      onClick={() => removeFromBlacklist(pattern)}
                      className="text-red-400 hover:text-red-300 text-sm font-medium"
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Examples */}
          <div className="bg-gc-bg rounded-lg p-4 text-sm">
            <h4 className="font-semibold text-gc-text mb-2">Pattern Examples:</h4>
            <ul className="space-y-1 text-gc-text-dim">
              <li><code className="text-gc-primary">ls *</code> - matches "ls", "ls -la", "ls /tmp"</li>
              <li><code className="text-gc-primary">git status</code> - exact match only</li>
              <li><code className="text-gc-primary">rm -rf *</code> - matches any rm -rf command</li>
              <li><code className="text-gc-primary">sudo *</code> - matches any sudo command</li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-gc-card border-t border-gc-border px-6 py-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gc-border hover:bg-gc-border/80 text-gc-text rounded font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default BlockingModal;
