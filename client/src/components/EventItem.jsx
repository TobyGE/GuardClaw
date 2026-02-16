import { useState } from 'react';

function EventItem({ event }) {
  const [showDetails, setShowDetails] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

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
    // For chat-update with summary, show summary instead of full text
    if ((eventType === 'chat-update' || eventType === 'chat-message') && event.summary) {
      return event.summary;
    }
    
    if (event.command) return event.command;
    if (event.description) return event.description;
    
    // Don't show full AI response text for chat-update
    // The streaming steps will show the details
    if ((eventType === 'chat-update' || eventType === 'chat-message') && event.streamingSteps && event.streamingSteps.length > 0) {
      const toolCount = event.streamingSteps.filter(s => s.type === 'tool_use').length;
      if (toolCount > 0) {
        return `Agent response with ${toolCount} tool call${toolCount > 1 ? 's' : ''}`;
      }
    }
    
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

            {/* Streaming Steps button (only if steps exist) */}
            {event.streamingSteps && event.streamingSteps.length > 0 && (
              <button
                onClick={() => setShowSteps(!showSteps)}
                className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors flex items-center space-x-1"
              >
                <span>{showSteps ? '▼' : '▶'}</span>
                <span>📋 Streaming Steps ({event.streamingSteps.length})</span>
              </button>
            )}

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

          {/* Streaming Steps Section */}
          {showSteps && event.streamingSteps && event.streamingSteps.length > 0 && (
            <div className="mt-3 ml-6 space-y-3 text-sm bg-blue-50 dark:bg-blue-900/20 p-3 rounded border border-blue-200 dark:border-blue-800">
              <div className="flex items-center space-x-2 mb-2">
                <span className="text-lg">📋</span>
                <span className="text-blue-700 dark:text-blue-300 font-semibold">Streaming Steps Timeline</span>
              </div>
              <div className="space-y-2">
                {event.streamingSteps.map((step, idx) => {
                  const stepRisk = step.safeguard ? getRiskLevel(step.safeguard.riskScore) : null;
                  const stepIcon = step.type === 'thinking' ? '💭' :
                                   step.type === 'tool_use' ? '🔧' :
                                   step.type === 'exec' ? '⚡' :
                                   step.type === 'text' ? '💬' : '📝';
                  
                  return (
                    <div key={step.id || idx} className="bg-white dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center space-x-2">
                          <span>{stepIcon}</span>
                          <span className="font-medium text-gray-900 dark:text-white">
                            {step.type === 'tool_use' && step.toolName ? step.toolName : step.type}
                          </span>
                          {stepRisk && (
                            <span className={`text-xs px-2 py-0.5 rounded font-medium ${stepRisk.color}`}>
                              {stepRisk.label} ({step.safeguard.riskScore})
                            </span>
                          )}
                        </div>
                        {step.duration && (
                          <span className="text-xs text-gray-500">
                            {step.duration}ms
                          </span>
                        )}
                      </div>
                      
                      {/* Tool Input Parameters */}
                      {step.type === 'tool_use' && step.metadata && step.metadata.input && (
                        <div className="mb-2">
                          <span className="text-xs text-gray-600 dark:text-gray-400">Input:</span>
                          <code className="block mt-1 text-xs bg-gray-100 dark:bg-gray-900 p-2 rounded overflow-x-auto">
                            {JSON.stringify(step.metadata.input, null, 2)}
                          </code>
                        </div>
                      )}
                      
                      {/* Tool Result */}
                      {step.type === 'tool_use' && step.metadata && step.metadata.result && (
                        <div className="mb-2">
                          <span className="text-xs text-gray-600 dark:text-gray-400">Result:</span>
                          <code className="block mt-1 text-xs bg-gray-100 dark:bg-gray-900 p-2 rounded overflow-x-auto">
                            {typeof step.metadata.result === 'string' 
                              ? step.metadata.result 
                              : JSON.stringify(step.metadata.result, null, 2)}
                          </code>
                        </div>
                      )}
                      
                      {/* Exec command (legacy) */}
                      {step.command && (
                        <div className="mb-2">
                          <span className="text-xs text-gray-600 dark:text-gray-400">Command:</span>
                          <code className="block mt-1 text-xs bg-gray-100 dark:bg-gray-900 p-2 rounded overflow-x-auto">
                            {step.command}
                          </code>
                        </div>
                      )}
                      
                      {/* Text content for thinking/text steps */}
                      {step.content && step.type !== 'tool_use' && (
                        <div className="mb-2">
                          <span className="text-xs text-gray-600 dark:text-gray-400">Content:</span>
                          <div className="mt-1 text-xs text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-900 p-2 rounded overflow-x-auto max-h-32 overflow-y-auto">
                            {step.content}
                            {step.content.length >= 200 && '... (truncated)'}
                          </div>
                        </div>
                      )}
                      
                      {/* Phase progression indicator */}
                      {step.metadata && step.metadata.phases && step.metadata.phases.length > 1 && (
                        <div className="mb-2">
                          <span className="text-xs text-gray-600 dark:text-gray-400">Phases:</span>
                          <div className="mt-1 flex space-x-1">
                            {step.metadata.phases.map((phase, pIdx) => (
                              <span key={pIdx} className="text-xs px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                                {phase}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {step.safeguard && step.safeguard.reasoning && (
                        <div>
                          <span className="text-xs text-gray-600 dark:text-gray-400">Analysis:</span>
                          <p className="mt-1 text-xs text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-900 p-2 rounded">
                            {step.safeguard.reasoning}
                          </p>
                        </div>
                      )}
                      
                      {step.safeguard && step.safeguard.warnings && step.safeguard.warnings.length > 0 && (
                        <div className="mt-2">
                          <span className="text-xs text-orange-600 dark:text-orange-400 font-medium">⚠️ Warnings:</span>
                          <ul className="mt-1 list-disc list-inside text-xs text-gray-700 dark:text-gray-300">
                            {step.safeguard.warnings.map((warning, wIdx) => (
                              <li key={wIdx}>{warning}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })}
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
