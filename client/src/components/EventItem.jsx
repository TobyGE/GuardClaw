import { useState } from 'react';

function EventItem({ event }) {
  const [expanded, setExpanded] = useState(false);

  const getRiskLevel = (score) => {
    if (score <= 3) return { label: 'SAFE', color: 'text-gc-safe bg-gc-safe/20' };
    if (score <= 7) return { label: 'WARNING', color: 'text-gc-warning bg-gc-warning/20' };
    return { label: 'BLOCKED', color: 'text-gc-danger bg-gc-danger/20' };
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
  };

  const riskLevel = event.safeguard?.riskScore !== undefined 
    ? getRiskLevel(event.safeguard.riskScore)
    : null;

  const eventType = event.tool || 'unknown';
  const displayName = `${eventType}${event.command ? ' (exec)' : ''}`;
  const status = event.status || 'completed';

  return (
    <div className="px-6 py-4 hover:bg-gc-border/10 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center space-x-3 mb-2">
            <span className="text-gc-text font-medium">{displayName}</span>
            {status === 'aborted' && (
              <span className="text-xs px-2 py-1 rounded bg-gc-text-dim/20 text-gc-text-dim">
                (aborted)
              </span>
            )}
            {riskLevel && (
              <span className={`text-xs px-2 py-1 rounded font-medium ${riskLevel.color}`}>
                {riskLevel.label} ({event.safeguard.riskScore}/10)
              </span>
            )}
          </div>

          {/* Command or details */}
          {event.command && (
            <div className="mb-3">
              <code className="text-sm text-gc-text-dim bg-gc-bg px-2 py-1 rounded">
                {event.command.length > 100 
                  ? event.command.substring(0, 100) + '...' 
                  : event.command}
              </code>
            </div>
          )}

          {/* Security Analysis Section */}
          {event.safeguard && (
            <div className="mt-2">
              <button
                onClick={() => setExpanded(!expanded)}
                className="flex items-center space-x-2 text-sm text-gc-primary hover:text-gc-primary/80 transition-colors"
              >
                <span className="text-lg">{expanded ? '▼' : '▶'}</span>
                <span>🛡️ Security Analysis ({event.safeguard.category || 'general'} - {event.safeguard.riskScore}/10)</span>
              </button>

              {expanded && (
                <div className="mt-3 ml-6 space-y-2 text-sm">
                  <div>
                    <span className="text-gc-text-dim">Risk Score:</span>
                    <span className="ml-2 text-gc-text font-medium">{event.safeguard.riskScore}/10</span>
                  </div>
                  {event.safeguard.category && (
                    <div>
                      <span className="text-gc-text-dim">Category:</span>
                      <span className="ml-2 text-gc-text">{event.safeguard.category}</span>
                    </div>
                  )}
                  {event.safeguard.reasoning && (
                    <div>
                      <span className="text-gc-text-dim">Reasoning:</span>
                      <p className="mt-1 text-gc-text">{event.safeguard.reasoning}</p>
                    </div>
                  )}
                  {event.safeguard.concerns && event.safeguard.concerns.length > 0 && (
                    <div>
                      <span className="text-gc-text-dim">Concerns:</span>
                      <ul className="mt-1 list-disc list-inside text-gc-text">
                        {event.safeguard.concerns.map((concern, idx) => (
                          <li key={idx}>{concern}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {!expanded && (
                <div className="mt-2 ml-6">
                  <button
                    onClick={() => setExpanded(true)}
                    className="text-xs text-gc-text-dim hover:text-gc-text transition-colors"
                  >
                    ▸ Show details
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Timestamp */}
        <div className="text-sm text-gc-text-dim ml-4">
          {formatTime(event.timestamp || Date.now())}
        </div>
      </div>
    </div>
  );
}

export default EventItem;
