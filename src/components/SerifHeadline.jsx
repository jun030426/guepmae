function SerifHeadline({
  as: Tag = 'h2',
  size = 'h2',
  align = 'left',
  eyebrow,
  children,
  className,
}) {
  const sizeStyle = {
    display: 'clamp(48px, 6vw, 88px)',
    h1: 'clamp(36px, 4.5vw, 56px)',
    h2: 'clamp(28px, 3vw, 40px)',
    h3: '22px',
  }[size];

  const wrapperStyle = align === 'center' ? { textAlign: 'center' } : undefined;

  const headingStyle = {
    fontFamily: 'var(--font-serif)',
    fontWeight: 500,
    fontSize: sizeStyle,
    letterSpacing: 'var(--ls-tight)',
    lineHeight: 'var(--lh-tight)',
    color: 'var(--color-text)',
    margin: 0,
  };

  return (
    <div className={className} style={wrapperStyle}>
      {eyebrow && <p className="section-eyebrow">{eyebrow}</p>}
      <Tag style={headingStyle}>{children}</Tag>
    </div>
  );
}

export default SerifHeadline;
