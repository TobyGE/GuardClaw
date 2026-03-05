import { useState, useEffect } from 'react';
import { BrainIcon, LinkIcon, CpuIcon, LlamaIcon, SearchIcon } from './icons';

// Reusable styled components
const Card = ({ children, className = '' }) => (
  <div className={`rounded-xl border border-gc-border bg-gc-bg p-5 ${className}`}>
    {children}
  </div>
);

const Label = ({ children, hint }) => (
  <div className="mb-2">
    <span className="text-sm font-semibold text-gc-text">{children}</span>
    {hint && <span className="ml-2 text-xs text-gc-text-dim">{hint}</span>}
  </div>
);

const Input = ({ ...props }) => (
  <input
    {...props}
    className={`w-full px-3.5 py-2.5 rounded-lg border border-gc-border
      bg-gc-card text-gc-text text-sm
      placeholder-gc-text-dim
      focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 dark:focus:ring-blue-400/40 dark:focus:border-blue-400
      transition-all duration-150 ${props.className || ''}`}
  />
);

const Btn = ({ variant = 'secondary', children, className = '', ...props }) => {
  const base = 'px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2';
  const variants = {
    primary: 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-sm shadow-blue-600/20',
    secondary: 'bg-gc-card border border-gc-border text-gc-text-secondary hover:bg-gc-border',
    success: 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-600/20',
    ghost: 'text-gc-text-dim hover:text-gc-text hover:bg-gc-border',
  };
  return <button {...props} className={`${base} ${variants[variant]} ${className}`}>{children}</button>;
};

const Toast = ({ message }) => {
  if (!message) return null;
  const isSuccess = message.type === 'success';
  return (
    <div className={`flex items-center gap-2.5 px-4 py-3 rounded-lg text-sm font-medium animate-in fade-in slide-in-from-top-1 ${
      isSuccess
        ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
        : 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
    }`}>
      <span>{isSuccess ? '✓' : '✕'}</span>
      <span>{message.text}</span>
    </div>
  );
};

// Model card for the model picker
const ModelCard = ({ model, selected, onSelect, recommended }) => (
  <button
    onClick={() => onSelect(model)}
    className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-all duration-150 ${
      selected
        ? 'border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/20 shadow-sm shadow-blue-500/10'
        : 'border-gc-border hover:border-gc-text-dim bg-gc-card'
    }`}
  >
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <div className={`w-2 h-2 rounded-full ${selected ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
        <span className={`text-sm font-medium ${selected ? 'text-blue-700 dark:text-blue-300' : 'text-gc-text-secondary'}`}>
          {model}
        </span>
      </div>
      {recommended && (
        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
          recommended
        </span>
      )}
    </div>
  </button>
);

export default function SettingsModal({ isOpen, onClose, currentToken, currentLlmConfig, onSave, defaultTab }) {
  const [activeTab, setActiveTab] = useState(defaultTab || 'llm');
  useEffect(() => { if (defaultTab) setActiveTab(defaultTab); }, [defaultTab]);
  const [token, setToken] = useState(currentToken || '');
  const [llmBackend, setLlmBackend] = useState(currentLlmConfig?.backend || 'built-in');
  const [lmstudioUrl, setLmstudioUrl] = useState(currentLlmConfig?.lmstudioUrl || 'http://localhost:1234/v1');
  const [lmstudioModel, setLmstudioModel] = useState(currentLlmConfig?.lmstudioModel || 'qwen/qwen3-4b-2507');
  const [customLmstudioModel, setCustomLmstudioModel] = useState('');
  const [ollamaUrl, setOllamaUrl] = useState(currentLlmConfig?.ollamaUrl || 'http://localhost:11434');
  const [ollamaModel, setOllamaModel] = useState(currentLlmConfig?.ollamaModel || 'llama3');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [availableModels, setAvailableModels] = useState([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [showCustomInput, setShowCustomInput] = useState(false);

  // Built-in model management
  const [builtinModels, setBuiltinModels] = useState([]);

  const fetchBuiltinModels = async () => {
    try {
      const resp = await fetch('/api/models');
      const data = await resp.json();
      setBuiltinModels(data.models || []);
    } catch { setBuiltinModels([]); }
  };

  useEffect(() => {
    if (isOpen && llmBackend === 'built-in') {
      fetchBuiltinModels();
      const interval = setInterval(fetchBuiltinModels, 1500);
      return () => clearInterval(interval);
    }
  }, [isOpen, llmBackend]);

  // One-click setup: download (if needed) + load
  const handleSetupModel = async (modelId) => {
    setMessage(null);
    try {
      await fetch(`/api/models/${modelId}/setup`, { method: 'POST' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const handleCancelDownload = async (modelId) => {
    try {
      await fetch(`/api/models/${modelId}/cancel`, { method: 'POST' });
    } catch {}
  };

  const handleUnloadModel = async () => {
    try {
      await fetch('/api/models/unload', { method: 'POST' });
      fetchBuiltinModels();
    } catch {}
  };

  const handleDeleteModel = async (modelId) => {
    try {
      await fetch(`/api/models/${modelId}`, { method: 'DELETE' });
      fetchBuiltinModels();
    } catch {}
  };

  const fetchModels = async () => {
    setLoadingModels(true);
    try {
      const resp = await fetch('/api/config/llm/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backend: llmBackend, lmstudioUrl, ollamaUrl })
      });
      const data = await resp.json();
      setAvailableModels(data.models || []);
    } catch {
      setAvailableModels([]);
    } finally {
      setLoadingModels(false);
    }
  };

  useEffect(() => {
    if (isOpen && (llmBackend === 'lmstudio' || llmBackend === 'ollama')) {
      fetchModels();
    }
  }, [isOpen, llmBackend, lmstudioUrl, ollamaUrl]);

  if (!isOpen) return null;

  const handleSaveGateway = async () => {
    setSaving(true); setMessage(null);
    try {
      const response = await fetch('/api/config/token', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      const data = await response.json();
      if (response.ok) {
        setMessage({ type: 'success', text: 'Token saved! Reconnecting...' });
        setTimeout(() => { onSave({ token }); onClose(); }, 1500);
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to save token' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: `Error: ${error.message}` });
    } finally { setSaving(false); }
  };

  const handleSaveLlm = async () => {
    setSaving(true); setMessage(null);
    const finalModel = showCustomInput ? customLmstudioModel : lmstudioModel;
    try {
      const response = await fetch('/api/config/llm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          backend: llmBackend, lmstudioUrl, lmstudioModel: finalModel, ollamaUrl, ollamaModel
        })
      });
      const data = await response.json();
      if (response.ok) {
        setMessage({ type: 'success', text: 'Config saved — safeguard restarting with new model' });
        setTimeout(() => { onSave({ llm: { backend: llmBackend } }); onClose(); }, 1500);
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to save LLM config' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: `Error: ${error.message}` });
    } finally { setSaving(false); }
  };

  const handleTestConnection = async () => {
    setSaving(true); setMessage(null);
    const finalModel = showCustomInput ? customLmstudioModel : lmstudioModel;
    try {
      const response = await fetch('/api/config/llm/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          backend: llmBackend, lmstudioUrl, lmstudioModel: finalModel, ollamaUrl, ollamaModel
        })
      });
      const data = await response.json();
      if (response.ok && data.connected) {
        setMessage({ type: 'success', text: `Connected to ${data.backend}${data.models ? ` — ${data.models} models loaded` : ''}` });
      } else {
        setMessage({ type: 'error', text: data.message || data.error || 'Connection failed' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: `Error: ${error.message}` });
    } finally { setSaving(false); }
  };

  const handleAutoDetect = async () => {
    setSaving(true); setMessage(null);
    try {
      const response = await fetch('/api/config/detect-token');
      const data = await response.json();
      if (response.ok && data.token) {
        setToken(data.token);
        setMessage({ type: 'success', text: 'Token auto-detected from OpenClaw config' });
      } else {
        setMessage({ type: 'error', text: 'Could not find OpenClaw token' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: `Error: ${error.message}` });
    } finally { setSaving(false); }
  };

  const tabs = [
    { id: 'llm', icon: <BrainIcon size={18} />, label: 'LLM Judge' },
    { id: 'gateway', icon: <LinkIcon size={18} />, label: 'Gateway' },
  ];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-gc-card rounded-2xl w-full max-w-2xl shadow-2xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gc-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-sm">⚙</div>
            <h2 className="text-lg font-bold text-gc-text">Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gc-text hover:bg-gc-border transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex px-6 pt-3 gap-1">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setMessage(null); }}
              className={`px-4 py-2 rounded-t-lg text-sm font-medium transition-all duration-150 ${
                activeTab === tab.id
                  ? 'bg-gc-border text-gc-text'
                  : 'text-gc-text-dim hover:text-gc-text'
              }`}
            >
              <span className="mr-1.5">{tab.icon}</span>{tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 bg-gc-bg">

          {/* ─── LLM Tab ─── */}
          {activeTab === 'llm' && (
            <>
              {/* Backend Picker */}
              <Card>
                <Label>Backend</Label>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { value: 'built-in', icon: <BrainIcon size={18} />, label: 'Built-in', desc: 'Runs on your Mac' },
                    { value: 'lmstudio', icon: <CpuIcon size={18} />, label: 'LM Studio', desc: 'External server' },
                    { value: 'ollama', icon: <LlamaIcon size={18} />, label: 'Ollama', desc: 'External server' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => {
                        setLlmBackend(opt.value);
                        // Auto-save backend selection when switching to built-in
                        if (opt.value === 'built-in') {
                          fetch('/api/config/llm', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ backend: 'built-in' })
                          }).catch(() => {});
                        }
                      }}
                      disabled={saving}
                      className={`flex items-center gap-3 p-3.5 rounded-lg border-2 transition-all duration-150 text-left ${
                        llmBackend === opt.value
                          ? 'border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/20'
                          : 'border-gc-border hover:border-gc-text-dim bg-gc-card'
                      }`}
                    >
                      <span className="text-2xl">{opt.icon}</span>
                      <div>
                        <div className={`text-sm font-semibold ${llmBackend === opt.value ? 'text-blue-700 dark:text-blue-300' : 'text-gc-text-secondary'}`}>{opt.label}</div>
                        <div className="text-xs text-gray-400">{opt.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </Card>

              {/* Built-in Model Manager */}
              {llmBackend === 'built-in' && (
                <Card>
                  <Label hint="Runs directly on your Mac via Apple Silicon — no external software needed">Judge Model</Label>
                  <div className="space-y-3">
                    {builtinModels.map(m => {
                      const isBusy = m.downloading || m.loading;
                      return (
                        <div
                          key={m.id}
                          className={`rounded-xl border-2 transition-all overflow-hidden ${
                            m.loaded
                              ? 'border-green-500/60 bg-green-950/20'
                              : isBusy
                              ? 'border-blue-500/40 bg-blue-950/10'
                              : m.downloaded
                              ? 'border-gc-border bg-gc-card'
                              : 'border-dashed border-gc-border bg-gc-card'
                          }`}
                        >
                          <div className="p-4">
                            {/* Header row */}
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className={`text-sm font-semibold ${m.loaded ? 'text-green-400' : 'text-gc-text'}`}>{m.name}</span>
                                  {m.recommended && (
                                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
                                      recommended
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-gc-text-dim mt-1">{m.description} &middot; {m.size}</div>
                              </div>

                              {/* Action area */}
                              <div className="flex items-center gap-2 flex-shrink-0">
                                {/* State: Not downloaded, not busy → "Setup & Run" */}
                                {!m.downloaded && !isBusy && (
                                  <Btn variant="primary" onClick={() => handleSetupModel(m.id)} className="!text-xs !px-4 !py-2">
                                    Setup &amp; Run
                                  </Btn>
                                )}

                                {/* State: Downloaded but not loaded or busy → "Run" + "Delete" */}
                                {m.downloaded && !m.loaded && !isBusy && (
                                  <>
                                    <Btn variant="success" onClick={() => handleSetupModel(m.id)} className="!text-xs !px-4 !py-2">
                                      Run
                                    </Btn>
                                    <Btn variant="ghost" onClick={() => handleDeleteModel(m.id)} className="!text-xs !px-2 !py-2 !text-red-400 hover:!text-red-300">
                                      Delete
                                    </Btn>
                                  </>
                                )}

                                {/* State: Loaded → "Active" indicator + "Stop" */}
                                {m.loaded && (
                                  <>
                                    <span className="flex items-center gap-1.5 text-xs font-medium text-green-400">
                                      <span className="relative flex h-2 w-2">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                                      </span>
                                      Active
                                    </span>
                                    <Btn variant="ghost" onClick={handleUnloadModel} className="!text-xs !px-2 !py-2 !text-gc-text-dim">
                                      Stop
                                    </Btn>
                                  </>
                                )}
                              </div>
                            </div>

                            {/* Progress / status area (downloading or loading) */}
                            {isBusy && (
                              <div className="mt-3 space-y-2">
                                {/* Progress bar for download */}
                                {m.downloading && (
                                  <div>
                                    <div className="h-2 rounded-full bg-gc-border overflow-hidden">
                                      <div
                                        className="h-full bg-gradient-to-r from-blue-500 to-blue-400 rounded-full transition-all duration-500 ease-out"
                                        style={{ width: `${Math.max(m.progress, 2)}%` }}
                                      />
                                    </div>
                                  </div>
                                )}

                                {/* Loading spinner for load phase */}
                                {m.loading && !m.downloading && (
                                  <div className="h-2 rounded-full bg-gc-border overflow-hidden">
                                    <div className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full animate-pulse" style={{ width: '100%' }} />
                                  </div>
                                )}

                                {/* Status text + cancel */}
                                <div className="flex items-center justify-between">
                                  <span className="text-xs text-blue-400 flex items-center gap-1.5">
                                    <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                    {m.statusMessage || (m.downloading ? `Downloading... ${m.progress}%` : 'Loading model...')}
                                  </span>
                                  {m.downloading && (
                                    <button
                                      onClick={() => handleCancelDownload(m.id)}
                                      className="text-[11px] text-gc-text-dim hover:text-red-400 transition-colors"
                                    >
                                      Cancel
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {builtinModels.length === 0 && (
                      <div className="text-sm text-gc-text-dim text-center py-6">Loading model catalog...</div>
                    )}
                  </div>

                  {/* Requirements note */}
                  <p className="text-[11px] text-gc-text-dim mt-3 leading-relaxed">
                    Requires Apple Silicon Mac with Python 3.10+. First run installs dependencies automatically (~2 min).
                  </p>
                </Card>
              )}

              {/* LM Studio Config */}
              {llmBackend === 'lmstudio' && (
                <>
                  <Card>
                    <Label hint="OpenAI-compatible endpoint">Server URL</Label>
                    <Input
                      type="text"
                      value={lmstudioUrl}
                      onChange={(e) => setLmstudioUrl(e.target.value)}
                      placeholder="http://localhost:1234/v1"
                      disabled={saving}
                    />
                  </Card>

                  <Card>
                    <div className="flex items-center justify-between mb-3">
                      <Label>Judge Model</Label>
                      <div className="flex items-center gap-2">
                        {loadingModels && (
                          <span className="text-xs text-gray-400 animate-pulse">fetching…</span>
                        )}
                        <Btn variant="ghost" onClick={fetchModels} disabled={loadingModels} className="!px-2 !py-1 text-xs">
                          ↻ Refresh
                        </Btn>
                      </div>
                    </div>

                    {availableModels.length > 0 ? (
                      <div className="space-y-2">
                        {availableModels.map(model => (
                          <ModelCard
                            key={model}
                            model={model}
                            selected={lmstudioModel === model && !showCustomInput}
                            onSelect={(m) => { setLmstudioModel(m); setShowCustomInput(false); }}
                            recommended={model === 'qwen/qwen3-4b-2507'}
                          />
                        ))}

                        {/* Custom option */}
                        <button
                          onClick={() => setShowCustomInput(!showCustomInput)}
                          className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-all duration-150 ${
                            showCustomInput
                              ? 'border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/20'
                              : 'border-dashed border-gc-border hover:border-gc-text-dim bg-gc-card'
                          }`}
                        >
                          <span className="text-sm text-gc-text-dim">+ Use a custom model name</span>
                        </button>

                        {showCustomInput && (
                          <Input
                            type="text"
                            value={customLmstudioModel}
                            onChange={(e) => setCustomLmstudioModel(e.target.value)}
                            placeholder="e.g., deepseek-coder-33b"
                            disabled={saving}
                            autoFocus
                          />
                        )}

                        <p className="text-xs text-gc-text-dim pt-1">
                          {availableModels.length} model{availableModels.length !== 1 ? 's' : ''} loaded in LM Studio
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                          <span>⚠️</span>
                          <span className="text-sm text-amber-700 dark:text-amber-300">
                            {loadingModels ? 'Connecting to LM Studio…' : 'No models found — is LM Studio running?'}
                          </span>
                        </div>
                        <Input
                          type="text"
                          value={lmstudioModel}
                          onChange={(e) => setLmstudioModel(e.target.value)}
                          placeholder="qwen/qwen3-4b-2507"
                          disabled={saving}
                        />
                      </div>
                    )}
                  </Card>
                </>
              )}

              {/* Ollama Config */}
              {llmBackend === 'ollama' && (
                <>
                  <Card>
                    <Label hint="Ollama API endpoint">Server URL</Label>
                    <Input
                      type="text"
                      value={ollamaUrl}
                      onChange={(e) => setOllamaUrl(e.target.value)}
                      placeholder="http://localhost:11434"
                      disabled={saving}
                    />
                    <p className="mt-2 text-xs text-gray-400">
                      Make sure Ollama is running: <code className="px-1.5 py-0.5 rounded bg-gc-border text-xs">ollama serve</code>
                    </p>
                  </Card>

                  <Card>
                    <div className="flex items-center justify-between mb-3">
                      <Label>Judge Model</Label>
                      <div className="flex items-center gap-2">
                        {loadingModels && (
                          <span className="text-xs text-gray-400 animate-pulse">fetching…</span>
                        )}
                        <Btn variant="ghost" onClick={fetchModels} disabled={loadingModels} className="!px-2 !py-1 text-xs">
                          ↻ Refresh
                        </Btn>
                      </div>
                    </div>
                    {availableModels.length > 0 ? (
                      <div className="space-y-2">
                        {availableModels.map(model => (
                          <ModelCard
                            key={model}
                            model={model}
                            selected={ollamaModel === model && !showCustomInput}
                            onSelect={(m) => { setOllamaModel(m); setShowCustomInput(false); }}
                            recommended={model.includes('qwen3') || model.includes('qwen2.5')}
                          />
                        ))}

                        <button
                          onClick={() => setShowCustomInput(!showCustomInput)}
                          className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-all duration-150 ${
                            showCustomInput
                              ? 'border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/20'
                              : 'border-dashed border-gc-border hover:border-gc-text-dim bg-gc-card'
                          }`}
                        >
                          <span className="text-sm text-gc-text-dim">+ Use a custom model name</span>
                        </button>

                        {showCustomInput && (
                          <Input
                            type="text"
                            value={ollamaModel}
                            onChange={(e) => setOllamaModel(e.target.value)}
                            placeholder="e.g., llama3:8b"
                            disabled={saving}
                            autoFocus
                          />
                        )}

                        <p className="text-xs text-gc-text-dim pt-1">
                          {availableModels.length} model{availableModels.length !== 1 ? 's' : ''} available in Ollama
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                          <span>⚠️</span>
                          <span className="text-sm text-amber-700 dark:text-amber-300">
                            {loadingModels ? 'Connecting to Ollama…' : 'No models found — is Ollama running?'}
                          </span>
                        </div>
                        <Input
                          type="text"
                          value={ollamaModel}
                          onChange={(e) => setOllamaModel(e.target.value)}
                          placeholder="llama3"
                          disabled={saving}
                        />
                        <p className="text-xs text-gray-400">
                          Pull a model first: <code className="px-1.5 py-0.5 rounded bg-gc-border text-xs">ollama pull qwen3:4b</code>
                        </p>
                      </div>
                    )}
                  </Card>
                </>
              )}
            </>
          )}

          {/* ─── Gateway Tab ─── */}
          {activeTab === 'gateway' && (
            <Card>
              <Label hint="from ~/.openclaw/openclaw.json">OpenClaw Gateway Token</Label>
              <div className="flex gap-2">
                <Input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Click detect or paste token..."
                  disabled={saving}
                  style={{ fontFamily: 'monospace', fontSize: '13px' }}
                />
                <Btn variant="secondary" onClick={handleAutoDetect} disabled={saving} className="shrink-0">
                  <SearchIcon size={14} />
                </Btn>
              </div>
            </Card>
          )}

          {/* Toast */}
          <Toast message={message} />
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gc-border bg-gc-card">
          <Btn variant="ghost" onClick={onClose} disabled={saving}>
            {activeTab === 'llm' && llmBackend === 'built-in' ? 'Close' : 'Cancel'}
          </Btn>
          <div className="flex gap-2">
            {activeTab === 'llm' && llmBackend !== 'built-in' && (
              <>
                <Btn variant="secondary" onClick={handleTestConnection} disabled={saving}>
                  {saving ? '...' : <><SearchIcon size={14} /> Test</>}
                </Btn>
                <Btn variant="primary" onClick={handleSaveLlm} disabled={saving}>
                  {saving ? 'Saving…' : 'Save & Apply'}
                </Btn>
              </>
            )}
            {activeTab === 'gateway' && (
              <Btn variant="primary" onClick={handleSaveGateway} disabled={saving || !token}>
                {saving ? 'Saving…' : 'Save & Reconnect'}
              </Btn>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
