import { useState, useEffect, useRef } from 'react';

const VERDICT_STYLE = {
  SAFE: 'text-gc-safe bg-gc-safe/20',
  WARNING: 'text-yellow-500 bg-yellow-500/20',
  BLOCK: 'text-gc-danger bg-gc-danger/20',
  ANALYZING: 'text-blue-400 bg-blue-400/20 animate-pulse',
  ALLOW: 'text-gc-safe bg-gc-safe/20',
};

function VerdictBadge({ verdict }) {
  const cls = VERDICT_STYLE[verdict] || 'text-gray-400 bg-gray-400/20';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${cls}`}>
      {verdict}
    </span>
  );
}

// Binary verdict: BLOCK or ALLOW
function binaryVerdict(v) {
  return v === 'BLOCK' ? 'BLOCK' : 'ALLOW';
}

export default function BenchmarkModal({ isOpen, onClose }) {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState([]);
  const [summary, setSummary] = useState(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [loadingModels, setLoadingModels] = useState(false);
  const esRef = useRef(null);

  // Fetch available models from both LM Studio and Ollama
  useEffect(() => {
    if (!isOpen) return;
    setLoadingModels(true);

    const fetchBoth = async () => {
      const all = [];
      // LM Studio
      try {
        const r = await fetch('/api/config/llm/models', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ backend: 'lmstudio', lmstudioUrl: 'http://127.0.0.1:1234/v1' })
        });
        const d = await r.json();
        (d.models || []).forEach(m => all.push({ id: m, source: 'lmstudio' }));
      } catch {}
      // Ollama
      try {
        const r = await fetch('/api/config/llm/models', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ backend: 'ollama', ollamaUrl: 'http://127.0.0.1:11434' })
        });
        const d = await r.json();
        (d.models || []).forEach(m => all.push({ id: m, source: 'ollama' }));
      } catch {}
      setModels(all);
      if (!selectedModel && all.length) setSelectedModel(all[0].id);
      setLoadingModels(false);
    };
    fetchBoth();
  }, [isOpen]);

  useEffect(() => {
    return () => { if (esRef.current) esRef.current.close(); };
  }, []);

  if (!isOpen) return null;

  const handleRun = () => {
    setRunning(true);
    setResults([]);
    setSummary(null);
    setProgress(null);
    setError(null);

    const selectedMeta = models.find(m => m.id === selectedModel);
    const backend = selectedMeta?.source || 'lmstudio';
    const url = selectedModel
      ? `/api/benchmark/run?model=${encodeURIComponent(selectedModel)}&backend=${backend}`
      : '/api/benchmark/run';
    const es = new EventSource(url);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'progress') {
          setProgress({ current: data.current, total: data.total, accuracy: data.accuracy });
          setResults(prev => [...prev, data.result]);
        } else if (data.type === 'complete') {
          setSummary(data);
          setRunning(false);
          es.close();
        } else if (data.type === 'error') {
          setError(data.error);
          setRunning(false);
          es.close();
        }
      } catch {}
    };

    es.onerror = () => {
      setError('Connection lost');
      setRunning(false);
      es.close();
    };
  };

  const accColor = (acc) => acc >= 0.95 ? 'text-gc-safe' : acc >= 0.80 ? 'text-yellow-500' : 'text-gc-danger';

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-[#1a1d23] rounded-2xl w-full max-w-4xl shadow-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700/50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-600 flex items-center justify-center text-white text-sm">🧪</div>
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Model Benchmark</h2>
              <p className="text-xs text-gray-400">BLOCK vs ALLOW · 30 tool-trace scenarios</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">✕</button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

          {/* Model picker */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Test Model</span>
              {loadingModels && <span className="text-xs text-gray-400 animate-pulse">loading...</span>}
            </div>
            {models.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {models.map(m => (
                  <button
                    key={`${m.source}:${m.id}`}
                    onClick={() => setSelectedModel(m.id)}
                    disabled={running}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border-2 transition-all flex items-center gap-1.5 ${
                      selectedModel === m.id
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                        : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300'
                    }`}
                  >
                    <span className="text-[10px] opacity-50">{m.source === 'ollama' ? '🦙' : '🖥️'}</span>
                    {m.id.split('/').pop()}
                  </button>
                ))}
              </div>
            ) : (
              <input
                type="text"
                value={selectedModel}
                onChange={e => setSelectedModel(e.target.value)}
                placeholder="qwen/qwen3-4b-2507"
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white"
                disabled={running}
              />
            )}
          </div>

          {/* Summary cards */}
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 p-4 text-center">
                <div className={`text-3xl font-bold ${accColor(summary.accuracy)}`}>{(summary.accuracy * 100).toFixed(1)}%</div>
                <div className="text-xs text-gray-400 mt-1">Accuracy</div>
              </div>
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 p-4 text-center">
                <div className="text-3xl font-bold text-gray-700 dark:text-gray-200">{summary.correct}/{summary.total}</div>
                <div className="text-xs text-gray-400 mt-1">Correct</div>
              </div>
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 p-4 text-center">
                <div className="text-3xl font-bold text-blue-500">{summary.avgLatencyMs}ms</div>
                <div className="text-xs text-gray-400 mt-1">Avg Latency</div>
              </div>
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 p-4 text-center">
                <div className={`text-3xl font-bold ${summary.falsePositives === 0 ? 'text-gc-safe' : 'text-yellow-500'}`}>{summary.falsePositives}</div>
                <div className="text-xs text-gray-400 mt-1">False Positives</div>
              </div>
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 p-4 text-center">
                <div className={`text-3xl font-bold ${summary.falseNegatives === 0 ? 'text-gc-safe' : 'text-gc-danger'}`}>{summary.falseNegatives}</div>
                <div className="text-xs text-gray-400 mt-1">False Negatives</div>
              </div>
            </div>
          )}

          {/* ALLOW / BLOCK breakdown */}
          {summary && (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 flex items-center justify-between">
                <VerdictBadge verdict="ALLOW" />
                <span className={`text-sm font-bold ${summary.summary.allow.correct === summary.summary.allow.total ? 'text-gc-safe' : 'text-yellow-500'}`}>
                  {summary.summary.allow.correct}/{summary.summary.allow.total}
                </span>
              </div>
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 flex items-center justify-between">
                <VerdictBadge verdict="BLOCK" />
                <span className={`text-sm font-bold ${summary.summary.block.correct === summary.summary.block.total ? 'text-gc-safe' : 'text-gc-danger'}`}>
                  {summary.summary.block.correct}/{summary.summary.block.total}
                </span>
              </div>
            </div>
          )}

          {/* Progress bar */}
          {running && progress && (
            <div>
              <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400 mb-2">
                <span>Trace {progress.current}/{progress.total}</span>
                <span className={accColor(progress.accuracy)}>{(progress.accuracy * 100).toFixed(0)}%</span>
              </div>
              <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-blue-500 to-cyan-500 rounded-full transition-all duration-300"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }} />
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              ❌ {error}
            </div>
          )}

          {/* Results table */}
          {results.length > 0 && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-800/50 text-left text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    <th className="px-4 py-2.5 w-8"></th>
                    <th className="px-4 py-2.5">Trace</th>
                    <th className="px-4 py-2.5 w-24">Expected</th>
                    <th className="px-4 py-2.5 w-24">Actual</th>
                    <th className="px-4 py-2.5 w-16 text-right">Score</th>
                    <th className="px-4 py-2.5 w-16 text-right">ms</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {results.map((r) => (
                    <tr key={r.id} className={r.correct ? '' : 'bg-red-50/50 dark:bg-red-900/10'}>
                      <td className="px-4 py-2.5 text-center">{r.correct ? '✅' : '❌'}</td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-gray-700 dark:text-gray-200">{r.label}</div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          {r.tools.map((t, i) => (
                            <span key={i}>
                              {i > 0 && <span className="mx-1 text-gray-300">→</span>}
                              <span className="font-mono">{t}</span>
                            </span>
                          ))}
                        </div>
                        {!r.correct && r.reasoning && (
                          <div className="text-xs text-red-500 dark:text-red-400 mt-1 italic">
                            {r.reasoning.substring(0, 150)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5"><VerdictBadge verdict={binaryVerdict(r.expected)} /></td>
                      <td className="px-4 py-2.5"><VerdictBadge verdict={binaryVerdict(r.actual)} /></td>
                      <td className="px-4 py-2.5 text-right font-mono text-gray-500">{r.score}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-gray-400">{r.elapsed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Empty state */}
          {!running && results.length === 0 && !error && (
            <div className="text-center py-12">
              <div className="text-4xl mb-3">🧪</div>
              <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-200 mb-2">Security Benchmark</h3>
              <p className="text-sm text-gray-400 max-w-md mx-auto mb-1">
                30 tool-trace scenarios testing BLOCK detection accuracy.
              </p>
              <p className="text-xs text-gray-400 max-w-md mx-auto">
                Each trace simulates a real agent workflow (read → edit → exec) and tests whether
                the judge correctly blocks dangerous tool chains while allowing safe ones.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 dark:border-gray-700/50 bg-white dark:bg-[#1a1d23]">
          <button onClick={onClose} className="px-4 py-2.5 rounded-lg text-sm font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">Close</button>
          <button
            onClick={handleRun}
            disabled={running || !selectedModel}
            className="px-5 py-2.5 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {running ? `Running (${progress?.current || 0}/${progress?.total || '?'})...` : summary ? '↻ Run Again' : '▶ Run Benchmark'}
          </button>
        </div>
      </div>
    </div>
  );
}
