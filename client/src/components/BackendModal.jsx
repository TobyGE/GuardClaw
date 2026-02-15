export default function BackendModal({ isOpen, onClose, backend, stats, events }) {
  if (!isOpen || !backend) return null;

  const getBackendIcon = (name) => {
    if (name === 'openclaw') return '🔗';
    if (name === 'nanobot') return '🤖';
    return '🔧';
  };

  const getBackendName = (name) => {
    if (name === 'openclaw') return 'OpenClaw';
    if (name === 'nanobot') return 'Nanobot';
    return name;
  };

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" 
      onClick={onClose}
    >
      <div 
        className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-2xl w-full mx-4 shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center space-x-3">
            <span className="text-3xl">{getBackendIcon(backend)}</span>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              {getBackendName(backend)}
            </h2>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${
              stats?.connected 
                ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                : 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200'
            }`}>
              {stats?.connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-2xl"
          >
            ✕
          </button>
        </div>

        {/* Connection Stats */}
        <div className="space-y-4">
          <div className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              Connection Status
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Status:</span>
                <span className="font-medium text-gray-900 dark:text-white">
                  {stats?.connected ? 'Active' : 'Inactive'}
                </span>
              </div>
              {stats?.reconnectAttempts !== undefined && (
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Reconnect Attempts:</span>
                  <span className="font-medium text-gray-900 dark:text-white">
                    {stats.reconnectAttempts}
                  </span>
                </div>
              )}
              {stats?.autoReconnect !== undefined && (
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Auto-Reconnect:</span>
                  <span className="font-medium text-gray-900 dark:text-white">
                    {stats.autoReconnect ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
              )}
              {stats?.pendingRequests !== undefined && (
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Pending Requests:</span>
                  <span className="font-medium text-gray-900 dark:text-white">
                    {stats.pendingRequests}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Event Statistics */}
          {events && (
            <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
              <h3 className="text-sm font-semibold text-blue-700 dark:text-blue-300 mb-3">
                📊 Event Statistics
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-blue-600 dark:text-blue-400">Total Events:</span>
                  <span className="font-medium text-blue-900 dark:text-blue-100">
                    {events.total || 0}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-green-600 dark:text-green-400">Safe Commands:</span>
                  <span className="font-medium text-green-900 dark:text-green-100">
                    {events.safe || 0}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-orange-600 dark:text-orange-400">Warnings:</span>
                  <span className="font-medium text-orange-900 dark:text-orange-100">
                    {events.warnings || 0}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-red-600 dark:text-red-400">Blocked:</span>
                  <span className="font-medium text-red-900 dark:text-red-100">
                    {events.blocked || 0}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Backend-specific info */}
          {backend === 'openclaw' && (
            <div className="bg-purple-50 dark:bg-purple-900/20 p-4 rounded-lg border border-purple-200 dark:border-purple-800">
              <h3 className="text-sm font-semibold text-purple-700 dark:text-purple-300 mb-2">
                ℹ️ OpenClaw Gateway
              </h3>
              <p className="text-xs text-purple-600 dark:text-purple-400">
                Full-featured AI agent platform with multi-channel support (Telegram, WhatsApp, Discord, etc.)
              </p>
            </div>
          )}

          {backend === 'nanobot' && (
            <div className="bg-teal-50 dark:bg-teal-900/20 p-4 rounded-lg border border-teal-200 dark:border-teal-800">
              <h3 className="text-sm font-semibold text-teal-700 dark:text-teal-300 mb-2">
                ℹ️ Nanobot Gateway
              </h3>
              <p className="text-xs text-teal-600 dark:text-teal-400">
                Lightweight agent framework optimized for local deployment and tool execution monitoring
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-md
                       hover:bg-gray-300 dark:hover:bg-gray-600"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
