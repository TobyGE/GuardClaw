import { useState, useEffect, useRef } from 'react';
import StatCard from './components/StatCard';
import EventList from './components/EventList';
import MemoryPage from './components/MemoryPage';
import ConnectionModal from './components/ConnectionModal';
import SettingsModal from './components/SettingsModal';
import BlockingModal from './components/BlockingModal';
import BenchmarkModal from './components/BenchmarkModal';
import GuardClawLogo from './components/GuardClawLogo';
import { LockIcon, UnlockIcon, MonitorIcon, BenchmarkIcon, SettingsIcon, SunIcon, MoonIcon, BotIcon, GitBranchIcon, CheckIcon, BrainIcon } from './components/icons';

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
  const [backendFilter, setBackendFilter] = useState('openclaw'); // 'openclaw', 'nanobot'
  const [sessions, setSessions] = useState([]); // list of { key, label, parent, isSubagent, eventCount }
  const [selectedSession, setSelectedSession] = useState(null); // null = all sessions
  const [memoryStats, setMemoryStats] = useState(null);
  const [showGatewayModal, setShowGatewayModal] = useState(false);
  const [showLlmModal, setShowLlmModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showBlockingModal, setShowBlockingModal] = useState(false);
  const [showBenchmarkModal, setShowBenchmarkModal] = useState(false);
  const [currentToken, setCurrentToken] = useState('');
  const [llmConfig, setLlmConfig] = useState(null);
  const [blockingStatus, setBlockingStatus] = useState(null);
  const [failClosed, setFailClosed] = useState(true);
  const [showFailClosedModal, setShowFailClosedModal] = useState(false);
  const backendFilterRef = useRef(backendFilter);
  const selectedSessionRef = useRef(selectedSession);
  useEffect(() => { backendFilterRef.current = backendFilter; }, [backendFilter]);
  useEffect(() => { selectedSessionRef.current = selectedSession; }, [selectedSession]);
  const [activePage, setActivePage] = useState('events'); // 'events' | 'memory'
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
          fetchSessions();
          fetch('/api/memory/stats').then(r => r.json()).then(setMemoryStats).catch(() => {});
        }
      } catch (error) {
        console.error('Failed to connect:', error);
        setConnected(false);
        setLlmStatus(null);
      }
    };

    const fetchSessions = async () => {
      try {
        const response = await fetch('/api/sessions');
        if (response.ok) {
          const data = await response.json();
          setSessions(data.sessions || []);
        }
      } catch (error) {
        console.error('Failed to fetch sessions:', error);
      }
    };

    const fetchEvents = async (filter = null, backend = 'all', session = null) => {
      try {
        const filterParam = filter ? `&filter=${filter}` : '';
        const backendParam = backend !== 'all' ? `&backend=${backend}` : '';
        const sessionParam = session ? `&session=${encodeURIComponent(session)}` : '';
        const response = await fetch(`/api/events/history?limit=9999${filterParam}${backendParam}${sessionParam}`);
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
        const isUpdate = newEvent._update;
        delete newEvent._update;

        if (isUpdate) {
          // Replace existing event in-place (e.g. analysis result arrived)
          setEvents((prev) => prev.map(ev => ev.id === newEvent.id ? newEvent : ev));
          // Update stats if analysis just completed (was pending → now scored)
          if (newEvent.safeguard && !newEvent.safeguard.pending && newEvent.safeguard.riskScore != null) {
            const score = newEvent.safeguard.riskScore;
            setStats((prev) => ({
              ...prev,
              safeCommands: score <= 3 ? prev.safeCommands + 1 : prev.safeCommands,
              warnings: score > 3 && score <= 7 ? prev.warnings + 1 : prev.warnings,
              blocked: score > 7 ? prev.blocked + 1 : prev.blocked,
            }));
          }
          return;
        }

        // New event — update total count (risk stats update when analysis completes)
        const score = newEvent.safeguard?.riskScore;
        const isPending = newEvent.safeguard?.pending;
        setStats((prev) => ({
          totalEvents: prev.totalEvents + 1,
          safeCommands: !isPending && score != null && score <= 3 ? prev.safeCommands + 1 : prev.safeCommands,
          warnings: !isPending && score != null && score > 3 && score <= 7 ? prev.warnings + 1 : prev.warnings,
          blocked: !isPending && score != null && score > 7 ? prev.blocked + 1 : prev.blocked,
        }));
        // Add to events list (apply backend + session filter)
        const eventSessionKey2 = newEvent.sessionKey || newEvent.payload?.sessionKey || '';
        const bf = backendFilterRef.current;
        const ss = selectedSessionRef.current;
        const matchesBackend = bf === 'all'
          || (bf === 'openclaw' && eventSessionKey2.includes('agent:'))
          || (bf === 'nanobot' && eventSessionKey2.includes('nanobot'));
        const matchesSession = !ss || eventSessionKey2 === ss;
        if (matchesBackend && matchesSession) {
          setEvents((prev) => [newEvent, ...prev]);
        }
        // If this event has a new sessionKey, refresh sessions list
        const eventSessionKey = newEvent.sessionKey;
        if (eventSessionKey) {
          setSessions((prev) => {
            const exists = prev.some(s => s.key === eventSessionKey);
            if (!exists) {
              fetch('/api/sessions').then(r => r.json()).then(data => setSessions(data.sessions || [])).catch(() => {});
              return prev;
            }
            return prev.map(s => s.key === eventSessionKey ? { ...s, eventCount: s.eventCount + 1, lastEventTime: Date.now() } : s);
          });
        }
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

    // Session status refresh (sub-agent active/inactive) — lightweight, every 30s
    const sessionRefresh = setInterval(fetchSessions, 30000);

    return () => {
      eventSource.close();
      clearInterval(sessionRefresh);
    };
  }, []);

  // Refetch events when filter, backend, or session changes
  useEffect(() => {
    const refetchEvents = async () => {
      try {
        const filterParam = eventFilter ? `&filter=${eventFilter}` : '';
        const sessionParam = selectedSession ? `&session=${encodeURIComponent(selectedSession)}` : '';
        const response = await fetch(`/api/events/history?limit=9999${filterParam}${sessionParam}`);
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
  }, [eventFilter, backendFilter, selectedSession]);

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

      <BenchmarkModal
        isOpen={showBenchmarkModal}
        onClose={() => setShowBenchmarkModal(false)}
      />

      {/* Fail-Closed Modal */}
      {showFailClosedModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowFailClosedModal(false)}>
          <div className="bg-gc-card rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gc-border">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm ${
                  failClosed ? 'bg-gradient-to-br from-orange-500 to-red-600' : 'bg-gradient-to-br from-gray-500 to-gray-600'
                }`}>
                  {failClosed ? <LockIcon size={20} /> : <UnlockIcon size={20} />}
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gc-text">Offline Protection</h2>
                  <p className="text-xs text-gc-text-dim">What happens when GuardClaw goes offline?</p>
                </div>
              </div>
              <button onClick={() => setShowFailClosedModal(false)} className="w-8 h-8 rounded-lg flex items-center justify-center text-gc-text-dim hover:text-gc-text hover:bg-gc-border transition-colors">✕</button>
            </div>

            {/* Content */}
            <div className="px-6 py-5 space-y-4">
              <div className="rounded-xl border border-gc-border bg-gc-bg p-5">
                <span className="text-sm font-semibold text-gc-text mb-3 block">Offline Behavior</span>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => applyFailClosed(true)}
                    className={`flex items-center gap-3 p-4 rounded-lg border-2 transition-all text-left ${
                      failClosed
                        ? 'border-orange-500 bg-orange-500/10 shadow-sm shadow-orange-500/10'
                        : 'border-gc-border hover:border-orange-500/30 bg-gc-card'
                    }`}
                  >
                    <LockIcon size={24} />
                    <div>
                      <div className={`text-sm font-semibold ${failClosed ? 'text-orange-400' : 'text-gc-text-secondary'}`}>Fail-Closed</div>
                      <div className="text-xs text-gc-text-dim mt-0.5">Block risky tools offline</div>
                    </div>
                  </button>

                  <button
                    onClick={() => applyFailClosed(false)}
                    className={`flex items-center gap-3 p-4 rounded-lg border-2 transition-all text-left ${
                      !failClosed
                        ? 'border-gc-primary bg-gc-primary/10 shadow-sm shadow-gc-primary/10'
                        : 'border-gc-border hover:border-gc-primary/30 bg-gc-card'
                    }`}
                  >
                    <UnlockIcon size={24} />
                    <div>
                      <div className={`text-sm font-semibold ${!failClosed ? 'text-gc-primary' : 'text-gc-text-secondary'}`}>Fail-Open</div>
                      <div className="text-xs text-gc-text-dim mt-0.5">Allow all tools offline</div>
                    </div>
                  </button>
                </div>

                <div className={`mt-4 rounded-lg px-4 py-3 text-xs leading-relaxed ${
                  failClosed
                    ? 'bg-orange-500/5 border border-orange-500/15 text-orange-300'
                    : 'bg-gc-primary/5 border border-gc-primary/15 text-gc-text-dim'
                }`}>
                  {failClosed
                    ? '⚠️ When GuardClaw is unreachable, high-risk tools (exec, write, browser, etc.) are blocked. Only read-only operations (read, web_search, session_status) are allowed.'
                    : 'When GuardClaw is unreachable, all tools run without restriction. Agent workflow is uninterrupted but unmonitored.'
                  }
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-gc-border bg-gc-card">
              <span className="text-xs text-gc-text-dim">Changes take effect immediately</span>
              <button onClick={() => setShowFailClosedModal(false)} className="px-4 py-2.5 rounded-lg text-sm font-medium text-gc-text-dim hover:text-gc-text hover:bg-gc-border transition-colors">Done</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="border-b border-gc-border bg-gc-card">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-6">
            <a href="https://tobyge.github.io/GuardClaw/" target="_blank" rel="noopener noreferrer" className="flex items-center space-x-3 hover:opacity-80 transition-opacity">
              <GuardClawLogo size={36} />
              <h1 className="text-2xl font-bold text-gc-primary">GuardClaw</h1>
            </a>
            <nav className="flex items-center space-x-1">
              <button
                onClick={() => setActivePage('events')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  activePage === 'events'
                    ? 'bg-gc-primary/20 text-gc-primary'
                    : 'text-gc-text-secondary hover:text-gc-text hover:bg-gc-border/50'
                }`}
              >
                Events
              </button>
              <button
                onClick={() => setActivePage('memory')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  activePage === 'memory'
                    ? 'bg-gc-primary/20 text-gc-primary'
                    : 'text-gc-text-secondary hover:text-gc-text hover:bg-gc-border/50'
                }`}
              >
                Memory
              </button>
            </nav>
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
              title={failClosed ? 'Fail-Closed: On' : 'Fail-Closed: Off'}
            >
              {failClosed ? <LockIcon size={20} /> : <UnlockIcon size={20} />}
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
                  ? `🛡️ Active Blocking (${blockingStatus.mode}): Auto-allow ≤${blockingStatus.thresholds?.autoAllow}, Auto-block ≥${blockingStatus.thresholds?.autoBlock}\n\nClick to configure`
                  : '📡 Monitor Only — tool calls are logged but not blocked\n\nClick to configure'
                }
              >
                {blockingStatus.active ? <GuardClawLogo size={22} /> : <MonitorIcon size={20} />}
              </button>
            )}
            <button
              onClick={() => setShowBenchmarkModal(true)}
              className="inline-flex items-center px-3 py-2 rounded-lg text-xl transition-opacity hover:opacity-80 bg-gc-border"
              title="Model Benchmark"
            >
              <BenchmarkIcon size={20} />
            </button>
            <button
              onClick={() => setShowSettingsModal(true)}
              className="inline-flex items-center px-3 py-2 rounded-lg text-xl transition-opacity hover:opacity-80 bg-gc-border"
              title="Settings"
            >
              <SettingsIcon size={20} />
            </button>
            <button
              onClick={() => setDarkMode(!darkMode)}
              className="inline-flex items-center px-3 py-2 rounded-lg text-xl transition-opacity hover:opacity-80 bg-gc-border"
              title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {darkMode ? <SunIcon size={20} /> : <MoonIcon size={20} />}
            </button>
            {/* Removed status indicators - now shown in backend selector below */}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {activePage === 'memory' ? (
          <MemoryPage />
        ) : (
          <>
            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4 mb-8">
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
              <StatCard
                title="PATTERNS LEARNED"
                value={memoryStats?.totalPatterns || 0}
                color="text-purple-400"
                onClick={() => setActivePage('memory')}
              />
            </div>

            {/* Backend Selector */}
            <div className="mb-6 bg-gc-card rounded-lg border border-gc-border p-4">
              <div className="flex items-center space-x-3">
                <span className="text-sm font-medium text-gc-text">Backend:</span>
                <div className="flex items-center space-x-2">
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

              {/* Session Tabs — only show for OpenClaw events */}
              {sessions.length > 1 && backendFilter !== 'nanobot' && (
                <div className="px-6 py-2 border-b border-gc-border flex-shrink-0 flex items-center gap-2 overflow-x-auto">
                  <button
                    onClick={() => setSelectedSession(null)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                      selectedSession === null
                        ? 'bg-gc-primary text-white'
                        : 'bg-gc-border/50 text-gc-text-dim hover:bg-gc-border'
                    }`}
                  >
                    All Sessions
                  </button>
                  {sessions.map((s) => (
                    <button
                      key={s.key}
                      onClick={() => setSelectedSession(s.key)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                        selectedSession === s.key
                          ? 'bg-gc-primary text-white'
                          : 'bg-gc-border/50 text-gc-text-dim hover:bg-gc-border'
                      } ${s.isSubagent && !s.active ? 'opacity-40' : ''}`}
                    >
                      <span>{s.isSubagent ? (s.active ? <GitBranchIcon size={14} /> : <CheckIcon size={14} />) : <BotIcon size={14} />}</span>
                      <span>{s.label}</span>
                      <span className="text-[10px] opacity-60">({s.eventCount})</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="flex-1 overflow-y-auto">
                <EventList events={
                  selectedSession
                    ? events.filter(e => e.sessionKey === selectedSession)
                    : events
                } />
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default App;
