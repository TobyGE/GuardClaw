function ConnectionModal({ isOpen, onClose, title, details }) {
  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div 
        className="bg-gc-card border border-gc-border rounded-lg p-6 max-w-md w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold">{title}</h3>
          <button
            onClick={onClose}
            className="text-gc-text-secondary hover:text-gc-text transition-colors"
          >
            ✕
          </button>
        </div>
        
        <div className="space-y-3">
          {details.map((item, idx) => (
            <div key={idx} className="flex flex-col">
              <span className="text-sm text-gc-text-secondary">{item.label}</span>
              <span className="text-gc-text font-mono text-sm break-all">
                {item.value}
              </span>
            </div>
          ))}
        </div>

        <button
          onClick={onClose}
          className="mt-6 w-full px-4 py-2 bg-gc-primary/10 hover:bg-gc-primary/20 text-gc-primary rounded-lg transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
}

export default ConnectionModal;
