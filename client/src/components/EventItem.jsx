import { useState } from 'react';

function EventItem({ event }) {
  const [showDetails, setShowDetails] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);

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

  const eventType = event.type || event.tool || 'unknown';
  const displayName = eventType === 'tool-call' 
    ? `${event.tool}` 
    : eventType === 'chat-update' 
    ? 'chat-message'
    : eventType;
  
  const status = event.status || 'completed';

  // Extract description/content
  const getEventContent = () => {
    if (event.command) return event.command;
    if (event.description) return event.description;
    if (event.payload?.message?.content) {
      const content = event.payload.message.content;
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) {
        return content
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('\n');
      }
    }
    return null;
  };

  const content = getEventContent();

  return (
    <div className="px-6 py-4 hover:bg-gc-border/10 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          {/* Header with type and risk badge */}
          <div className="flex items-center space-x-3 mb-2">
            <span className="text-gc-text font-medium">
              {displayName === 'exec' ? '⚡ exec' : 
               displayName === 'chat-message' ? '💬 chat-message' :
               displayName === 'write' ? '📝 write' :
               displayName === 'edit' ? '✏️ edit' :
               displayName === 'read' ? '📖 read' :
               displayName === 'web_fetch' ? '🌐 web_fetch' :
               displayName === 'browser' ? '🌐 browser' :
               displayName === 'message' ? '📨 message' :
               `🔧 ${displayName}`}
            </span>
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

          {/* Content preview */}
          {content && (
            <div className="mb-3">
              <code className="text-sm text-gc-text-dim bg-gc-bg px-2 py-1 rounded inline-block max-w-full overflow-hidden text-ellipsis">
                {content.length > 150 
                  ? content.substring(0, 150) + '...' 
                  : content}
              </code>
            </div>
          )}

          {/* Buttons row */}
          <div className="flex items-center space-x-4 mt-2">
            {/* Show details button */}
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="text-xs text-gc-text-dim hover:text-gc-text transition-colors flex items-center space-x-1"
            >
              <span>{showDetails ? '▼' : '▶'}</span>
              <span>Show details</span>
            </button>

            {/* Security Analysis button (only if analyzed) */}
            {event.safeguard && event.safeguard.riskScore !== undefined && (
              <button
                onClick={() => setShowAnalysis(!showAnalysis)}
                className="text-xs text-gc-primary hover:text-gc-primary/80 transition-colors flex items-center space-x-1"
              >
                <span>{showAnalysis ? '▼' : '▶'}</span>
                <span>🛡️ Security Analysis ({event.safeguard.category || 'general'} - {event.safeguard.riskScore}/10)</span>
              </button>
            )}
          </div>

          {/* Show Details Section */}
          {showDetails && (
            <div className="mt-3 ml-6 space-y-2 text-sm bg-gc-bg/50 p-3 rounded border border-gc-border">
              <div>
                <span className="text-gc-text-dim">Event Type:</span>
                <span className="ml-2 text-gc-text">{eventType}</span>
              </div>
              {event.tool && (
                <div>
                  <span className="text-gc-text-dim">Tool:</span>
                  <span className="ml-2 text-gc-text">{event.tool}</span>
                </div>
              )}
              {event.command && (
                <div>
                  <span className="text-gc-text-dim">Command:</span>
                  <pre className="mt-1 text-gc-text bg-gc-bg p-2 rounded overflow-x-auto text-xs">
                    {event.command}
                  </pre>
                </div>
              )}
              {event.description && !event.command && (
                <div>
                  <span className="text-gc-text-dim">Description:</span>
                  <pre className="mt-1 text-gc-text bg-gc-bg p-2 rounded overflow-x-auto text-xs whitespace-pre-wrap">
                    {event.description}
                  </pre>
                </div>
              )}
              {event.payload && Object.keys(event.payload).length > 0 && (
                <div>
                  <span className="text-gc-text-dim">Payload:</span>
                  <pre className="mt-1 text-gc-text bg-gc-bg p-2 rounded overflow-x-auto text-xs">
                    {JSON.stringify(event.payload, null, 2).substring(0, 500)}
                    {JSON.stringify(event.payload).length > 500 ? '\n...(truncated)' : ''}
                  </pre>
                </div>
              )}
              <div>
                <span className="text-gc-text-dim">Event ID:</span>
                <span className="ml-2 text-gc-text font-mono text-xs">{event.id}</span>
              </div>
            </div>
          )}

          {/* Security Analysis Section */}
          {showAnalysis && event.safeguard && (
            <div className="mt-3 ml-6 space-y-2 text-sm bg-gc-primary/5 p-3 rounded border border-gc-primary/20">
              <div className="flex items-center space-x-2 mb-2">
                <span className="text-lg">🛡️</span>
                <span className="text-gc-primary font-semibold">Security Analysis</span>
              </div>
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
              {event.safeguard.backend && (
                <div>
                  <span className="text-gc-text-dim">Backend:</span>
                  <span className="ml-2 text-gc-text">{event.safeguard.backend}</span>
                </div>
              )}
              {event.safeguard.reasoning && (
                <div>
                  <span className="text-gc-text-dim">Reasoning:</span>
                  <p className="mt-1 text-gc-text bg-gc-bg/50 p-2 rounded">{event.safeguard.reasoning}</p>
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
              {event.safeguard.allowed !== undefined && (
                <div>
                  <span className="text-gc-text-dim">Action:</span>
                  <span className={`ml-2 font-medium ${event.safeguard.allowed ? 'text-gc-safe' : 'text-gc-danger'}`}>
                    {event.safeguard.allowed ? '✓ Allowed' : '✗ Blocked'}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Timestamp */}
        <div className="text-sm text-gc-text-dim ml-4 whitespace-nowrap">
          {formatTime(event.timestamp || Date.now())}
        </div>
      </div>
    </div>
  );
}

export default EventItem;
