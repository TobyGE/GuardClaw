import GuardClawLogo from './GuardClawLogo';
import { TerminalIcon, FileTextIcon, PencilIcon, GlobeIcon, MessageIcon, WrenchIcon, GitBranchIcon } from './icons';
import { useState } from 'react';
import { useI18n } from '../i18n/I18nContext.jsx';

function EventItem({ event }) {
  const { t, language } = useI18n();
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const [showFullContent, setShowFullContent] = useState(false);
  const CONTENT_PREVIEW_LINES = 2;

  const getRiskLevel = (score, pending, verdict) => {
    if (pending) return { label: t('analysis.analyzing'), color: 'text-blue-400 bg-blue-400/20 animate-pulse' };
    if (score < 6) return { label: t('analysis.safe'), color: 'text-gc-safe bg-gc-safe/20' };
    if (score < 9) return { label: t('analysis.warning'), color: 'text-gc-warning bg-gc-warning/20' };
    if (verdict === 'pass-through') return { label: t('analysis.flagged'), color: 'text-gc-danger bg-gc-danger/20' };
    return { label: t('analysis.blockedLabel'), color: 'text-gc-danger bg-gc-danger/20' };
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    
    if (isToday) {
      // Today: just show time
      return date.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        second: '2-digit',
        hour12: true 
      });
    } else {
      // Other days: show full date and time
      return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
    }
  };

  const riskLevel = event.safeguard?.riskScore !== undefined
    ? getRiskLevel(event.safeguard.riskScore, event.safeguard?.pending, event.safeguard?.verdict)
    : null;

  const isSubagent = event.sessionKey?.includes(':subagent:');
  const subagentShortId = isSubagent ? event.sessionKey.split(':subagent:')[1]?.substring(0, 8) : null;

  const eventType = event.type || event.tool || 'unknown';
  const displayName = eventType === 'tool-call' 
    ? `${event.tool}` 
    : eventType === 'chat-update' 
    ? 'chat-message'
    : eventType === 'claude-code-tool'
    ? `cc:${event.tool || 'unknown'}`
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
            <span className="text-gc-text font-medium inline-flex items-center gap-1.5">
              {(displayName === 'exec' || displayName === 'cc:exec') ? <><TerminalIcon size={14} /> {displayName}</> :
               displayName === 'chat-message' ? <><MessageIcon size={14} /> chat-message</> :
               (displayName === 'write' || displayName === 'cc:write') ? <><PencilIcon size={14} /> {displayName}</> :
               (displayName === 'edit' || displayName === 'cc:edit') ? <><PencilIcon size={14} /> {displayName}</> :
               (displayName === 'read' || displayName === 'cc:read') ? <><FileTextIcon size={14} /> {displayName}</> :
               displayName === 'web_fetch' ? <><GlobeIcon size={14} /> web_fetch</> :
               displayName === 'browser' ? <><GlobeIcon size={14} /> browser</> :
               displayName === 'message' ? <><MessageIcon size={14} /> message</> :
               <><WrenchIcon size={14} /> {displayName}</>}
            </span>
            {isSubagent && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 font-medium inline-flex items-center gap-1">
                <GitBranchIcon size={10} /> {subagentShortId}
              </span>
            )}
            {status === 'aborted' && (
              <span className="text-xs px-2 py-1 rounded bg-gc-text-dim/20 text-gc-text-dim">
                {t('eventItem.aborted')}
              </span>
            )}
            {riskLevel && (
              <span className={`text-xs px-2 py-1 rounded font-medium ${riskLevel.color}`}>
                {riskLevel.label}
              </span>
            )}
          </div>

          {/* Content preview */}
          {content && (() => {
            const lines = content.split('\n');
            const isLong = lines.length > CONTENT_PREVIEW_LINES;
            const displayContent = (!isLong || showFullContent) ? content : lines.slice(0, CONTENT_PREVIEW_LINES).join('\n');
            return (
              <div className="mb-3">
                <code className="text-sm text-gc-text-dim bg-gc-bg px-2 py-1 rounded block max-w-full break-words whitespace-pre-wrap overflow-x-auto">
                  {displayContent}
                </code>
                {isLong && (
                  <button
                    onClick={() => setShowFullContent(v => !v)}
                    className="text-xs text-blue-400 hover:text-blue-300 mt-1 transition-colors"
                  >
                    {showFullContent ? t('eventItem.collapse') : t('eventItem.expandAll', { lines: lines.length })}
                  </button>
                )}
              </div>
            );
          })()}

          {/* Buttons row */}
          <div className="flex items-center space-x-4 mt-2">
            {/* Streaming Steps button */}
            {event.streamingSteps && event.streamingSteps.length > 0 && (
              <button
                onClick={() => setShowSteps(!showSteps)}
                className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors flex items-center space-x-1"
              >
                <span>{showSteps ? '▼' : '▶'}</span>
                <span>📋 {t('eventItem.details', { count: event.streamingSteps.length, plural: language === 'en' && event.streamingSteps.length > 1 ? 's' : '' })}</span>
              </button>
            )}

            {/* Security Analysis button (only if analyzed) */}
            {event.safeguard && event.safeguard.riskScore !== undefined && (
              <button
                onClick={() => setShowAnalysis(!showAnalysis)}
                className="text-xs text-gc-primary hover:text-gc-primary/80 transition-colors flex items-center space-x-1"
              >
                <span>{showAnalysis ? '▼' : '▶'}</span>
                <span className='inline-flex items-center gap-1'><GuardClawLogo size={14} /> {t('analysis.securityAnalysis')} ({event.safeguard.category || 'general'})</span>
              </button>
            )}
          </div>

          {/* Streaming Steps Section */}
          {showSteps && event.streamingSteps && event.streamingSteps.length > 0 && (
            <div className="mt-3 ml-6 space-y-3 text-sm bg-blue-50 dark:bg-blue-900/20 p-3 rounded border border-blue-200 dark:border-blue-800">
              <div className="flex items-center space-x-2 mb-2">
                <span className="text-lg">📋</span>
                <span className="text-blue-700 dark:text-blue-300 font-semibold">{t('eventItem.eventDetails')}</span>
              </div>
              <div className="space-y-2">
                {event.streamingSteps.map((step, idx) => {
                  const stepRisk = step.safeguard ? getRiskLevel(step.safeguard.riskScore, step.safeguard?.pending, step.safeguard?.verdict) : null;
                  const stepIcon = step.type === 'thinking' ? '💭' :
                                   step.type === 'tool_use' ? <WrenchIcon size={12} className='inline' /> :
                                   step.type === 'exec' ? <TerminalIcon size={12} className='inline' /> :
                                   step.type === 'text' ? <MessageIcon size={12} className='inline' /> : <PencilIcon size={12} className='inline' />;
                  
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
                              {stepRisk.label}
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
                          <span className="text-xs text-gray-600 dark:text-gray-400">{t('eventItem.input')}</span>
                          <code className="block mt-1 text-xs bg-gray-100 dark:bg-gray-900 p-2 rounded overflow-x-auto">
                            {JSON.stringify(step.metadata.input, null, 2)}
                          </code>
                        </div>
                      )}
                      
                      {/* Tool Result */}
                      {step.type === 'tool_use' && step.metadata && step.metadata.result && (
                        <div className="mb-2">
                          <span className="text-xs text-gray-600 dark:text-gray-400">{t('eventItem.result')}</span>
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
                          <span className="text-xs text-gray-600 dark:text-gray-400">{t('eventItem.command')}</span>
                          <code className="block mt-1 text-xs bg-gray-100 dark:bg-gray-900 p-2 rounded overflow-x-auto">
                            {step.command}
                          </code>
                        </div>
                      )}
                      
                      {/* Text content for thinking/text steps */}
                      {step.content && step.type !== 'tool_use' && (
                        <div className="mb-2">
                          <span className="text-xs text-gray-600 dark:text-gray-400">{t('eventItem.content')}</span>
                          <div className="mt-1 text-xs text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-900 p-2 rounded overflow-x-auto max-h-32 overflow-y-auto">
                            {step.content}
                            {step.content.length >= 200 && t('eventItem.truncated')}
                          </div>
                        </div>
                      )}
                      
                      {/* Phase progression indicator */}
                      {step.metadata && step.metadata.phases && step.metadata.phases.length > 1 && (
                        <div className="mb-2">
                          <span className="text-xs text-gray-600 dark:text-gray-400">{t('eventItem.phases')}</span>
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
                          <span className="text-xs text-gray-600 dark:text-gray-400">{t('eventItem.analysis')}</span>
                          <p className="mt-1 text-xs text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-900 p-2 rounded">
                            {step.safeguard.reasoning}
                          </p>
                        </div>
                      )}
                      
                      {step.safeguard && step.safeguard.warnings && step.safeguard.warnings.length > 0 && (
                        <div className="mt-2">
                          <span className="text-xs text-orange-600 dark:text-orange-400 font-medium">⚠️ {t('eventItem.warnings')}</span>
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
                <GuardClawLogo size={20} />
                <span className="text-gc-primary font-semibold">{t('analysis.securityAnalysis')}</span>
              </div>
              <div>
                <span className="text-gc-text-dim">{t('analysis.riskScore')}</span>
                <span className="ml-2 text-gc-text font-medium">{event.safeguard.riskScore <= 3 ? t('analysis.safe') : event.safeguard.riskScore <= 7 ? t('analysis.warning') : event.safeguard.verdict === 'pass-through' ? t('analysis.flagged') : t('analysis.blockedLabel')}</span>
              </div>
              {event.safeguard.category && (
                <div>
                  <span className="text-gc-text-dim">{t('analysis.category')}</span>
                  <span className="ml-2 text-gc-text">{event.safeguard.category}</span>
                </div>
              )}
              {event.safeguard.backend && (
                <div>
                  <span className="text-gc-text-dim">{t('analysis.backend')}</span>
                  <span className="ml-2 text-gc-text">{event.safeguard.backend}</span>
                </div>
              )}
              {event.safeguard.reasoning && (
                <div>
                  <span className="text-gc-text-dim">{t('analysis.reasoning')}</span>
                  <p className="mt-1 text-gc-text bg-gc-bg/50 p-2 rounded">{event.safeguard.reasoning}</p>
                </div>
              )}
              {event.safeguard.concerns && event.safeguard.concerns.length > 0 && (
                <div>
                  <span className="text-gc-text-dim">{t('analysis.concerns')}</span>
                  <ul className="mt-1 list-disc list-inside text-gc-text">
                    {event.safeguard.concerns.map((concern, idx) => (
                      <li key={idx}>{concern}</li>
                    ))}
                  </ul>
                </div>
              )}
              {event.safeguard.allowed !== undefined && (
                <div>
                  <span className="text-gc-text-dim">{t('analysis.action')}</span>
                  <span className={`ml-2 font-medium ${event.safeguard.allowed ? 'text-gc-safe' : 'text-gc-danger'}`}>
                    {event.safeguard.allowed ? t('analysis.allowed') : t('analysis.blockedAction')}
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
