function StatCard({ title, value, color }) {
  return (
    <div className="bg-gc-card rounded-lg border border-gc-border p-6">
      <div className={`text-5xl font-bold mb-2 ${color}`}>{value}</div>
      <div className="text-sm text-gc-text-dim uppercase tracking-wide">{title}</div>
    </div>
  );
}

export default StatCard;
