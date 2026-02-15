function StatCard({ title, value, color, onClick, active }) {
  const isClickable = onClick !== undefined;
  
  return (
    <div
      className={`bg-gc-card rounded-lg border p-6 transition-all ${
        isClickable ? 'cursor-pointer hover:border-gc-primary hover:shadow-lg' : ''
      } ${active ? 'border-gc-primary ring-2 ring-gc-primary/50' : 'border-gc-border'}`}
      onClick={onClick}
    >
      <div className={`text-5xl font-bold mb-2 ${color}`}>{value}</div>
      <div className="text-sm text-gc-text-dim uppercase tracking-wide">
        {title}
        {active && <span className="ml-2">✓</span>}
      </div>
    </div>
  );
}

export default StatCard;
