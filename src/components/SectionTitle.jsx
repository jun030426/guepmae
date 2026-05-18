function SectionTitle({ eyebrow, title, description, align = 'left' }) {
  return (
    <div className={`section-title ${align === 'center' ? 'center' : ''}`}>
      {eyebrow && <p className="section-eyebrow">{eyebrow}</p>}
      <h2>{title}</h2>
      {description && <p>{description}</p>}
    </div>
  );
}

export default SectionTitle;
