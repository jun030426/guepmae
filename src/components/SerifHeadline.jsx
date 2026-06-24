function SerifHeadline({
  as: Tag = 'h2',
  size = 'h2',
  align = 'left',
  eyebrow,
  children,
  className,
}) {
  const sizeStyle = {
    display: 'clamp(40px, 5vw, 64px)',
    h1: 'clamp(32px, 4vw, 48px)',
    h2: 'clamp(26px, 3vw, 32px)',
    h3: '20px',
  }[size];

  // 새 시스템: Pretendard 단일, 위계는 굵기로 (Display/H1 800, H2/H3 700)
  const weight = size === 'h2' || size === 'h3' ? 700 : 800;

  const wrapperStyle = align === 'center' ? { textAlign: 'center' } : undefined;

  const headingStyle = {
    fontFamily: 'var(--font-sans)',
    fontWeight: weight,
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
