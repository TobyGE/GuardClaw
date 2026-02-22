import { useState, useEffect } from 'react';
import StatCard from './components/StatCard';
import EventList from './components/EventList';
import ConnectionModal from './components/ConnectionModal';
import SettingsModal from './components/SettingsModal';
import BlockingModal from './components/BlockingModal';

function App() {
  const [connected, setConnected] = useState(false);
  const [llmStatus, setLlmStatus] = useState(null);
  const [connectionStats, setConnectionStats] = useState(null);
  const [backends, setBackends] = useState(null);
  const [daysSinceInstall, setDaysSinceInstall] = useState(0);
  const [stats, setStats] = useState({
    totalEvents: 0,
    safeCommands: 0,
    warnings: 0,
    blocked: 0,
  });
  const [events, setEvents] = useState([]);
  const [eventFilter, setEventFilter] = useState(null); // 'safe', 'warning', 'blocked', or null
  const [backendFilter, setBackendFilter] = useState('all'); // 'all', 'openclaw', 'nanobot'
  const [showGatewayModal, setShowGatewayModal] = useState(false);
  const [showLlmModal, setShowLlmModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showBlockingModal, setShowBlockingModal] = useState(false);
  const [currentToken, setCurrentToken] = useState('');
  const [llmConfig, setLlmConfig] = useState(null);
  const [blockingStatus, setBlockingStatus] = useState(null);
  const [failClosed, setFailClosed] = useState(true);
  const [showFailClosedModal, setShowFailClosedModal] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    return saved !== null ? saved === 'true' : true; // Default to dark
  });

  useEffect(() => {
    // Apply dark mode class to document
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('darkMode', darkMode);
  }, [darkMode]);

  useEffect(() => {
    // Connect to backend WebSocket/SSE
    const connectToBackend = async () => {
      try {
        const response = await fetch('/api/status');
        if (response.ok) {
          const data = await response.json();
          setConnected(data.connected);
          setLlmStatus(data.llmStatus);
          setConnectionStats(data.connectionStats);
          setBackends(data.backends || null);
          setDaysSinceInstall(data.install?.daysSinceInstall || 0);
          setLlmConfig(data.llmConfig || null);
          setBlockingStatus(data.blocking || null);
          if (typeof data.failClosed === 'boolean') setFailClosed(data.failClosed);
          fetchEvents();
        }
      } catch (error) {
        console.error('Failed to connect:', error);
        setConnected(false);
        setLlmStatus(null);
      }
    };

    const fetchEvents = async (filter = null, backend = 'all') => {
      try {
        const filterParam = filter ? `&filter=${filter}` : '';
        const backendParam = backend !== 'all' ? `&backend=${backend}` : '';
        const response = await fetch(`/api/events/history?limit=2000${filterParam}${backendParam}`);
        if (response.ok) {
          const data = await response.json();
          const filteredEvents = backend === 'all' 
            ? data.events || []
            : (data.events || []).filter(e => {
                // Filter events by backend source (assuming events have a 'source' or 'backend' field)
                // For now, we'll use sessionKey to determine backend
                const sessionKey = e.sessionKey || e.payload?.sessionKey || '';
                if (backend === 'openclaw') return sessionKey.includes('agent:');
                if (backend === 'nanobot') return sessionKey.includes('nanobot');
                return true;
              });
          setEvents(filteredEvents);
          if (!filter) {
            // Update stats based on filtered events
            updateStats(filteredEvents);
          }
        }
      } catch (error) {
        console.error('Failed to fetch events:', error);
      }
    };

    const updateStats = (eventList) => {
      const stats = eventList.reduce(
        (acc, event) => {
          acc.totalEvents++;
          if (event.safeguard?.riskScore <= 3) {
            acc.safeCommands++;
          } else if (event.safeguard?.riskScore <= 7) {
            acc.warnings++;
          } else if (event.safeguard?.riskScore > 7) {
            acc.blocked++;
          }
          return acc;
        },
        { totalEvents: 0, safeCommands: 0, warnings: 0, blocked: 0 }
      );
      setStats(stats);
    };

    connectToBackend();

    // Set up SSE for real-time updates
    const eventSource = new EventSource('/api/events');
    
    eventSource.onmessage = (e) => {
      try {
        const newEvent = JSON.parse(e.data);
        setEvents((prev) => [newEvent, ...prev].slice(0, 100));
        setStats((prev) => ({
          totalEvents: prev.totalEvents + 1,
          safeCommands: newEvent.safeguard?.riskScore <= 3 ? prev.safeCommands + 1 : prev.safeCommands,
          warnings: newEvent.safeguard?.riskScore > 3 && newEvent.safeguard?.riskScore <= 7 ? prev.warnings + 1 : prev.warnings,
          blocked: newEvent.safeguard?.riskScore > 7 ? prev.blocked + 1 : prev.blocked,
        }));
      } catch (error) {
        console.error('Failed to parse event:', error);
      }
    };

    eventSource.onerror = () => {
      setConnected(false);
      eventSource.close();
      // Attempt to reconnect after 5 seconds
      setTimeout(connectToBackend, 5000);
    };

    // Periodic refresh to catch async summary updates (every 10 seconds)
    const refreshInterval = setInterval(() => {
      fetchEvents();
    }, 10000);

    return () => {
      eventSource.close();
      clearInterval(refreshInterval);
    };
  }, []);

  // Refetch events when filter or backend changes
  useEffect(() => {
    const refetchEvents = async () => {
      try {
        const filterParam = eventFilter ? `&filter=${eventFilter}` : '';
        const response = await fetch(`/api/events/history?limit=2000${filterParam}`);
        if (response.ok) {
          const data = await response.json();
          const filteredEvents = backendFilter === 'all' 
            ? data.events || []
            : (data.events || []).filter(e => {
                const sessionKey = e.sessionKey || e.payload?.sessionKey || '';
                if (backendFilter === 'openclaw') return sessionKey.includes('agent:');
                if (backendFilter === 'nanobot') return sessionKey.includes('nanobot');
                return true;
              });
          setEvents(filteredEvents);
        }
      } catch (error) {
        console.error('Failed to fetch filtered events:', error);
      }
    };
    refetchEvents();
  }, [eventFilter, backendFilter]);

  const getGatewayDetails = () => {
    if (!connectionStats) return [];
    return [
      { label: 'Status', value: connected ? 'Connected' : 'Disconnected' },
      { label: 'URL', value: connectionStats.url || 'ws://127.0.0.1:18789' },
      { label: 'Connected Since', value: connectionStats.connectedAt ? new Date(connectionStats.connectedAt).toLocaleString() : 'N/A' },
      { label: 'Reconnect Attempts', value: connectionStats.reconnectAttempts || 0 },
      { label: 'Total Reconnects', value: connectionStats.totalReconnects || 0 },
    ];
  };

  const getLlmDetails = () => {
    if (!llmStatus) return { details: [], modelList: [] };
    const details = [
      { label: 'Backend', value: llmStatus.backend },
      { label: 'Status', value: llmStatus.connected ? 'Connected' : 'Disconnected' },
      { label: 'Message', value: llmStatus.message },
    ];
    
    if (llmStatus.url) {
      details.push({ label: 'URL', value: llmStatus.url });
    }
    
    if (llmStatus.models !== undefined) {
      details.push({ label: 'Models Loaded', value: llmStatus.models });
    }
    
    if (llmStatus.error) {
      details.push({ label: 'Error', value: llmStatus.error });
    }
    
    return { 
      details, 
      modelList: llmStatus.modelNames || [] 
    };
  };

  const handleSaveToken = async (newToken) => {
    setCurrentToken(newToken);
    // Trigger reconnect by fetching status again
    setTimeout(async () => {
      try {
        const response = await fetch('/api/status');
        if (response.ok) {
          const data = await response.json();
          setConnected(data.connected);
          setConnectionStats(data.connectionStats);
          setBackends(data.backends || null);
        }
      } catch (error) {
        console.error('Failed to refresh status:', error);
      }
    }, 2000);
  };

  const applyFailClosed = async (enabled) => {
    setFailClosed(enabled);
    setShowFailClosedModal(false);
    try {
      await fetch('/api/config/fail-closed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
    } catch {
      setFailClosed(!enabled); // revert on error
    }
  };

  return (
    <div className="min-h-screen bg-gc-bg">
      {/* Modals */}
      <ConnectionModal
        isOpen={showGatewayModal}
        onClose={() => setShowGatewayModal(false)}
        title="Gateway Connection"
        details={getGatewayDetails()}
      />
      <ConnectionModal
        isOpen={showLlmModal}
        onClose={() => setShowLlmModal(false)}
        title="LLM Backend"
        details={getLlmDetails().details}
        modelList={getLlmDetails().modelList}
      />
      <SettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        currentToken={currentToken}
        currentLlmConfig={llmConfig}
        onSave={handleSaveToken}
      />
      <BlockingModal
        isOpen={showBlockingModal}
        onClose={() => {
          setShowBlockingModal(false);
          // Refresh status after modal closes
          setTimeout(() => {
            fetch('/api/status').then(r => r.json()).then(data => {
              setBlockingStatus(data.blocking || null);
              if (typeof data.failClosed === 'boolean') setFailClosed(data.failClosed);
            });
          }, 100);
        }}
        currentStatus={blockingStatus}
      />

      {/* Fail-Closed Modal */}
      {showFailClosedModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowFailClosedModal(false)}>
          <div className="bg-gc-card border border-gc-border rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <span className="text-3xl">{failClosed ? '🔒' : '🔓'}</span>
              <h2 className="text-xl font-bold text-gc-primary">离线保护模式</h2>
            </div>

            <div className="text-gc-text text-sm space-y-3 mb-6">
              <p>
                当 GuardClaw 服务离线（崩溃、重启、网络断开）时，agent 的工具调用应该如何处理？
              </p>
              <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-3">
                <div className="font-semibold text-orange-400 mb-1">🔒 Fail-Closed（当前：{failClosed ? '开启' : '关闭'}）</div>
                <p className="text-xs text-gc-muted">高风险工具（exec、write、browser 等）在 GuardClaw 离线期间全部 block，只允许只读操作。安全性优先，但 agent 可用性降低。</p>
              </div>
              <div className="bg-gray-500/10 border border-gray-500/20 rounded-lg p-3">
                <div className="font-semibold text-gray-400 mb-1">🔓 Fail-Open</div>
                <p className="text-xs text-gc-muted">GuardClaw 离线时所有工具正常运行，不受限制。可用性优先，但无保护。</p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => applyFailClosed(true)}
                className={`flex-1 py-2 rounded-lg font-medium text-sm transition-all ${
                  failClosed
                    ? 'bg-orange-500 text-white'
                    : 'bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30'
                }`}
              >
                🔒 开启 Fail-Closed
              </button>
              <button
                onClick={() => applyFailClosed(false)}
                className={`flex-1 py-2 rounded-lg font-medium text-sm transition-all ${
                  !failClosed
                    ? 'bg-gray-500 text-white'
                    : 'bg-gray-500/20 text-gray-400 border border-gray-500/30 hover:bg-gray-500/30'
                }`}
              >
                🔓 关闭（Fail-Open）
              </button>
            </div>
            <p className="text-xs text-gc-muted text-center mt-3">设置会立即生效并持久化</p>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="border-b border-gc-border bg-gc-card">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <span className="text-3xl">🛡️</span>
            <h1 className="text-2xl font-bold text-gc-primary">GuardClaw</h1>
          </div>
          <div className="flex items-center space-x-2">
            {/* Fail-Closed Toggle */}
            <button
              onClick={() => setShowFailClosedModal(true)}
              className={`inline-flex items-center px-3 py-2 rounded-lg text-xl transition-opacity hover:opacity-80 ${
                failClosed
                  ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30'
                  : 'bg-gray-500/20 text-gray-400 border border-gray-500/30 hover:bg-gray-500/30'
              }`}
              title={failClosed ? 'Fail-Closed: 开启' : 'Fail-Closed: 关闭'}
            >
              {failClosed ? '🔒' : '🔓'}
            </button>
            {/* Blocking Status Button */}
            {blockingStatus && (
              <button
                onClick={() => setShowBlockingModal(true)}
                className={`inline-flex items-center px-3 py-2 rounded-lg text-xl transition-opacity hover:opacity-80 ${
                  blockingStatus.active 
                    ? 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30' 
                    : 'bg-gray-500/20 text-gray-400 border border-gray-500/30 hover:bg-gray-500/30'
                }`}
                title={blockingStatus.active 
                  ? `Blocking Active (${blockingStatus.mode}): Auto-allow ≤${blockingStatus.thresholds?.autoAllow}, Auto-block ≥${blockingStatus.thresholds?.autoBlock}\n\nClick to configure`
                  : 'Blocking Disabled - Monitor Only\n\nClick to configure'
                }
              >
                {blockingStatus.active ? '🚫' : '👀'}
              </button>
            )}
            <button
              onClick={() => setShowSettingsModal(true)}
              className="inline-flex items-center px-3 py-2 rounded-lg text-xl transition-opacity hover:opacity-80 bg-gc-border"
              title="Settings"
            >
              ⚙️
            </button>
            <button
              onClick={() => setDarkMode(!darkMode)}
              className="inline-flex items-center px-3 py-2 rounded-lg text-xl transition-opacity hover:opacity-80 bg-gc-border"
              title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {darkMode ? '☀️' : '🌙'}
            </button>
            {/* Removed status indicators - now shown in backend selector below */}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          <StatCard
            title="DAYS PROTECTED"
            value={daysSinceInstall}
            color="text-blue-400"
          />
          <StatCard
            title="TOTAL EVENTS"
            value={stats.totalEvents}
            color="text-gc-text"
            onClick={() => setEventFilter(null)}
            active={eventFilter === null}
          />
          <StatCard
            title="SAFE COMMANDS"
            value={stats.safeCommands}
            color="text-gc-safe"
            onClick={() => setEventFilter(eventFilter === 'safe' ? null : 'safe')}
            active={eventFilter === 'safe'}
          />
          <StatCard
            title="WARNINGS"
            value={stats.warnings}
            color="text-gc-warning"
            onClick={() => setEventFilter(eventFilter === 'warning' ? null : 'warning')}
            active={eventFilter === 'warning'}
          />
          <StatCard
            title="BLOCKED"
            value={stats.blocked}
            color="text-gc-danger"
            onClick={() => setEventFilter(eventFilter === 'blocked' ? null : 'blocked')}
            active={eventFilter === 'blocked'}
          />
        </div>

        {/* Backend Selector */}
        <div className="mb-6 bg-gc-card rounded-lg border border-gc-border p-4">
          <div className="flex items-center space-x-3">
            <span className="text-sm font-medium text-gc-text">Backend:</span>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setBackendFilter('all')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  backendFilter === 'all'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-gc-border text-gc-text hover:bg-gc-border/80'
                }`}
              >
                All
              </button>
              {backends && backends.openclaw && (
                <button
                  onClick={() => setBackendFilter('openclaw')}
                  className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    backendFilter === 'openclaw'
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'bg-gc-border text-gc-text hover:bg-gc-border/80'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${
                    backends.openclaw.connected ? 'bg-green-500' : 'bg-red-500'
                  }`}></span>
                  <span>OpenClaw</span>
                </button>
              )}
              {backends && backends.nanobot && (
                <button
                  onClick={() => setBackendFilter('nanobot')}
                  className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    backendFilter === 'nanobot'
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'bg-gc-border text-gc-text hover:bg-gc-border/80'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${
                    backends.nanobot.connected ? 'bg-green-500' : 'bg-red-500'
                  }`}></span>
                  <span>Nanobot</span>
                </button>
              )}
            </div>
            <div className="flex-1"></div>
            <span className="text-xs text-gc-text-dim">
              Showing {events.length} event{events.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        {/* Events Section */}
        <div className="bg-gc-card rounded-lg border border-gc-border overflow-hidden flex flex-col" style={{ height: 'calc(100vh - 400px)', minHeight: '500px' }}>
          <div className="px-6 py-4 border-b border-gc-border flex-shrink-0">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">
                Real-time Events
                {backendFilter !== 'all' && (
                  <span className="ml-2 text-sm text-gc-text-dim">
                    ({backendFilter === 'openclaw' ? 'OpenClaw' : 'Nanobot'})
                  </span>
                )}
              </h2>
              {eventFilter && (
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-gc-text-dim">
                    Filtered: <span className="font-semibold capitalize">{eventFilter}</span>
                  </span>
                  <button
                    onClick={() => setEventFilter(null)}
                    className="text-xs px-2 py-1 rounded bg-gc-border hover:bg-gc-primary/20 transition-colors"
                  >
                    Clear Filter
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            <EventList events={events} />
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
