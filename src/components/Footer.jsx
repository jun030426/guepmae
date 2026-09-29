import { Link } from 'react-router-dom';

// 실제로 이동 가능한 목적지만 싣는다 — 존재하지 않는 페이지로의 죽은 링크는 날조.
const footerGroups = [
  {
    title: '서비스',
    links: [
      { label: '매물 보기', to: '/properties' },
      { label: '지도 검색', to: '/map' },
      { label: '급매 리포트', to: '/report' },
      { label: '급매 알림 관리', to: '/alerts' },
    ],
  },
  {
    title: '중개사',
    links: [
      { label: '급매 PRO 소개', to: '/agent' },
      { label: '중개사 가입 신청', to: '/agent/signup' },
    ],
  },
  {
    title: '데이터 출처',
    links: [
      {
        label: '국토교통부 실거래가 공개시스템',
        href: 'https://rt.molit.go.kr',
      },
    ],
  },
];

function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <Link to="/" className="footer-logo">
            급매
          </Link>
          <p>급매라고 주장하지 않고, 실거래가로 증명합니다.</p>
          <p className="footer-disclaimer">
            모든 분석은 과거 실거래 데이터의 패턴 설명이며, 투자 권유나 미래 가격 예측이 아닙니다.
          </p>
        </div>

        <div className="footer-menu">
          {footerGroups.map((group) => (
            <div key={group.title} className="footer-column">
              <h3>{group.title}</h3>
              {group.links.map((link) =>
                link.href ? (
                  <a key={link.label} href={link.href} target="_blank" rel="noreferrer">
                    {link.label}
                  </a>
                ) : (
                  <Link key={link.label} to={link.to}>
                    {link.label}
                  </Link>
                ),
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="footer-bottom">
        <span>© 2026 급매</span>
        <span>국토교통부 실거래가 · Google Maps Platform</span>
      </div>
    </footer>
  );
}

export default Footer;
