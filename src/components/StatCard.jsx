function StatCard({ icon: Icon, label, value, description, tone = 'default' }) {
  return (
    <article className={`stat-card ${tone}`}>
      {Icon && (
        <div className="stat-icon">
          <Icon size={22} />
        </div>
      )}
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{description}</p>
    </article>
  );
}

export default StatCard;
