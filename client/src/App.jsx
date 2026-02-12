import { useState, useEffect } from 'react';
import StatCard from './components/StatCard';
import EventList from './components/EventList';

function App() {
  const [connected, setConnected] = useState(false);
  const [llmStatus, setLlmStatus] = useState(null);
  const [daysSinceInstall, setDaysSinceInstall] = useState(0);
  const [stats, setStats] = useState({
    totalEvents: 0,
    safeCommands: 0,
    warnings: 0,
    blocked: 0,
  });
  const [events, setEvents] = useState([]);

  useEffect(() => {
    // Connect to backend WebSocket/SSE
    const connectToBackend = async () => {
      try {
        const response = await fetch('/api/status');
        if (response.ok) {
          const data = await response.json();
          setConnected(data.connected);
          setLlmStatus(data.llmStatus);
          setDaysSinceInstall(data.install?.daysSinceInstall || 0);
          fetchEvents();
        }
      } catch (error) {
        console.error('Failed to connect:', error);
        setConnected(false);
        setLlmStatus(null);
      }
    };

    const fetchEvents = async () => {
      try {
        const response = await fetch('/api/events/history?limit=50');
        if (response.ok) {
          const data = await response.json();
          setEvents(data.events || []);
          updateStats(data.events || []);
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

    return () => {
      eventSource.close();
    };
  }, []);

  return (
    <div className="min-h-screen bg-gc-bg">
      {/* Header */}
      <header className="border-b border-gc-border bg-gc-card">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <span className="text-3xl">🛡️</span>
            <div>
              <h1 className="text-2xl font-bold text-gc-primary">GuardClaw</h1>
              {daysSinceInstall > 0 && (
                <p className="text-xs text-gc-text-secondary mt-0.5">
                  守护 {daysSinceInstall} 天
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <span
              className={`inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium ${
                connected
                  ? 'bg-gc-safe/20 text-gc-safe'
                  : 'bg-gc-danger/20 text-gc-danger'
              }`}
            >
              {connected ? '✓ Gateway' : '✗ Gateway'}
            </span>
            {llmStatus && (
              <span
                className={`inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium ${
                  llmStatus.connected
                    ? 'bg-gc-safe/20 text-gc-safe'
                    : llmStatus.backend === 'fallback'
                    ? 'bg-gray-500/20 text-gray-400'
                    : 'bg-gc-danger/20 text-gc-danger'
                }`}
                title={`${llmStatus.backend}: ${llmStatus.message}`}
              >
                {llmStatus.connected
                  ? `✓ LLM${llmStatus.models > 0 ? ` (${llmStatus.models})` : ''}`
                  : llmStatus.backend === 'fallback'
                  ? '⚠ Fallback'
                  : `✗ LLM`}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard
            title="TOTAL EVENTS"
            value={stats.totalEvents}
            color="text-gc-text"
          />
          <StatCard
            title="SAFE COMMANDS"
            value={stats.safeCommands}
            color="text-gc-safe"
          />
          <StatCard
            title="WARNINGS"
            value={stats.warnings}
            color="text-gc-warning"
          />
          <StatCard
            title="BLOCKED"
            value={stats.blocked}
            color="text-gc-danger"
          />
        </div>

        {/* Events Section */}
        <div className="bg-gc-card rounded-lg border border-gc-border overflow-hidden flex flex-col" style={{ height: 'calc(100vh - 400px)', minHeight: '500px' }}>
          <div className="px-6 py-4 border-b border-gc-border flex-shrink-0">
            <h2 className="text-xl font-semibold">Real-time Events</h2>
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
