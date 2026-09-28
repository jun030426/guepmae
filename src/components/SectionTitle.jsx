function SectionTitle({ eyebrow, title, description, align = 'left', as: Heading = 'h2' }) {
  return (
    <div className={`section-title ${align === 'center' ? 'center' : ''}`}>
      {eyebrow && <p className="section-eyebrow">{eyebrow}</p>}
      <Heading>{title}</Heading>
      {description && <p>{description}</p>}
    </div>
  );
}

export default SectionTitle;
