import { useState } from 'react';

export default function SettingsModal({ isOpen, onClose, currentToken, currentLlmConfig, onSave }) {
  const [activeTab, setActiveTab] = useState('gateway');
  const [token, setToken] = useState(currentToken || '');
  const [llmBackend, setLlmBackend] = useState(currentLlmConfig?.backend || 'lmstudio');
  const [lmstudioUrl, setLmstudioUrl] = useState(currentLlmConfig?.lmstudioUrl || 'http://localhost:1234/v1');
  const [lmstudioModel, setLmstudioModel] = useState(currentLlmConfig?.lmstudioModel || 'auto');
  const [ollamaUrl, setOllamaUrl] = useState(currentLlmConfig?.ollamaUrl || 'http://localhost:11434');
  const [ollamaModel, setOllamaModel] = useState(currentLlmConfig?.ollamaModel || 'llama3');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  if (!isOpen) return null;

  const handleSaveGateway = async () => {
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
          onSave({ token });
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

  const handleSaveLlm = async () => {
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch('/api/config/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          backend: llmBackend,
          lmstudioUrl,
          lmstudioModel,
          ollamaUrl,
          ollamaModel
        })
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ type: 'success', text: 'LLM config saved! Restarting safeguard...' });
        setTimeout(() => {
          onSave({ llm: { backend: llmBackend } });
          onClose();
        }, 1500);
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to save LLM config' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: `Error: ${error.message}` });
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch('/api/config/llm/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          backend: llmBackend,
          lmstudioUrl,
          lmstudioModel,
          ollamaUrl,
          ollamaModel
        })
      });

      const data = await response.json();

      if (response.ok && data.connected) {
        setMessage({ 
          type: 'success', 
          text: `✅ ${data.backend.toUpperCase()}: ${data.message}${data.models ? ` (${data.models} models)` : ''}` 
        });
      } else {
        setMessage({ 
          type: 'error', 
          text: `❌ ${data.backend?.toUpperCase() || 'Connection'}: ${data.message || data.error}` 
        });
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
        className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-3xl w-full mx-4 shadow-xl max-h-[90vh] overflow-y-auto"
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

        {/* Tabs */}
        <div className="flex space-x-2 mb-6 border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setActiveTab('gateway')}
            className={`px-4 py-2 font-medium border-b-2 transition-colors ${
              activeTab === 'gateway'
                ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            🔗 Gateway
          </button>
          <button
            onClick={() => setActiveTab('llm')}
            className={`px-4 py-2 font-medium border-b-2 transition-colors ${
              activeTab === 'llm'
                ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            🧠 LLM Backend
          </button>
        </div>

        {/* Gateway Tab */}
        {activeTab === 'gateway' && (
          <div className="space-y-4">
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

            {message && (
              <div className={`p-3 rounded-md ${
                message.type === 'success' 
                  ? 'bg-green-50 dark:bg-green-900 text-green-800 dark:text-green-200'
                  : 'bg-red-50 dark:bg-red-900 text-red-800 dark:text-red-200'
              }`}>
                {message.text}
              </div>
            )}

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
                onClick={handleSaveGateway}
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
        )}

        {/* LLM Tab */}
        {activeTab === 'llm' && (
          <div className="space-y-4">
            {/* Backend Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Safeguard Backend
              </label>
              <div className="flex gap-4">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="radio"
                    value="lmstudio"
                    checked={llmBackend === 'lmstudio'}
                    onChange={(e) => setLlmBackend(e.target.value)}
                    className="text-blue-600 focus:ring-blue-500"
                    disabled={saving}
                  />
                  <span className="text-gray-900 dark:text-white">🖥️ LM Studio (Local)</span>
                </label>
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="radio"
                    value="ollama"
                    checked={llmBackend === 'ollama'}
                    onChange={(e) => setLlmBackend(e.target.value)}
                    className="text-blue-600 focus:ring-blue-500"
                    disabled={saving}
                  />
                  <span className="text-gray-900 dark:text-white">🦙 Ollama (Local)</span>
                </label>
              </div>
            </div>

            {/* LM Studio Config */}
            {llmBackend === 'lmstudio' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    LM Studio Server URL
                  </label>
                  <input
                    type="text"
                    value={lmstudioUrl}
                    onChange={(e) => setLmstudioUrl(e.target.value)}
                    placeholder="http://localhost:1234/v1"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md
                             bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                             focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent"
                    disabled={saving}
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Start LM Studio and load a model, then start the local server
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Model Name
                  </label>
                  <input
                    type="text"
                    value={lmstudioModel}
                    onChange={(e) => setLmstudioModel(e.target.value)}
                    placeholder="auto"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md
                             bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                             focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent"
                    disabled={saving}
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Set to <code>auto</code> to use first available model, or specify model name
                  </p>
                </div>
              </>
            )}

            {/* Ollama Config */}
            {llmBackend === 'ollama' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Ollama Server URL
                  </label>
                  <input
                    type="text"
                    value={ollamaUrl}
                    onChange={(e) => setOllamaUrl(e.target.value)}
                    placeholder="http://localhost:11434"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md
                             bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                             focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent"
                    disabled={saving}
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Make sure Ollama is running: <code>ollama serve</code>
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Model Name
                  </label>
                  <input
                    type="text"
                    value={ollamaModel}
                    onChange={(e) => setOllamaModel(e.target.value)}
                    placeholder="llama3"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md
                             bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                             focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent"
                    disabled={saving}
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Use <code>ollama list</code> to see available models
                  </p>
                </div>
              </>
            )}

            {message && (
              <div className={`p-3 rounded-md ${
                message.type === 'success' 
                  ? 'bg-green-50 dark:bg-green-900 text-green-800 dark:text-green-200'
                  : 'bg-red-50 dark:bg-red-900 text-red-800 dark:text-red-200'
              }`}>
                {message.text}
              </div>
            )}

            <div className="flex gap-3 pt-4">
              <button
                onClick={handleTestConnection}
                disabled={saving}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-md
                         hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                🔍 Test Connection
              </button>
              <button
                onClick={handleSaveLlm}
                disabled={saving}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md
                         hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? 'Saving...' : 'Save & Restart'}
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
        )}
      </div>
    </div>
  );
}
