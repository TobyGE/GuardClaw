import { useState } from 'react';

export default function SettingsModal({ isOpen, onClose, currentToken, onSave }) {
  const [token, setToken] = useState(currentToken || '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  if (!isOpen) return null;

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch('/api/config/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ type: 'success', text: 'Token saved! Reconnecting...' });
        setTimeout(() => {
          onSave(token);
          onClose();
        }, 1500);
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to save token' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: `Error: ${error.message}` });
    } finally {
      setSaving(false);
    }
  };

  const handleAutoDetect = async () => {
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch('/api/config/detect-token');
      const data = await response.json();

      if (response.ok && data.token) {
        setToken(data.token);
        setMessage({ type: 'success', text: 'Token auto-detected from OpenClaw config!' });
      } else {
        setMessage({ type: 'error', text: 'Could not find OpenClaw token' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: `Error: ${error.message}` });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={onClose}>
      <div 
        className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-2xl w-full mx-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Settings</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">
          {/* OpenClaw Token */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              OpenClaw Gateway Token
            </label>
            <input
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="36ca588ed550e209d765cccecd2c59fa25016c6c6c41890a"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md
                       bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                       focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent"
              disabled={saving}
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Find your token in <code>~/.openclaw/openclaw.json</code> under <code>gateway.auth.token</code>
            </p>
          </div>

          {/* Message */}
          {message && (
            <div className={`p-3 rounded-md ${
              message.type === 'success' 
                ? 'bg-green-50 dark:bg-green-900 text-green-800 dark:text-green-200'
                : 'bg-red-50 dark:bg-red-900 text-red-800 dark:text-red-200'
            }`}>
              {message.text}
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-3 pt-4">
            <button
              onClick={handleAutoDetect}
              disabled={saving}
              className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-md
                       hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              🔍 Auto-Detect
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !token}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md
                       hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : 'Save & Reconnect'}
            </button>
            <button
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-md
                       hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
