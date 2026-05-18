import { Link } from 'react-router-dom';

const footerGroups = [
  {
    title: '서비스',
    links: ['매물', '지도 검색', '집 내놓기', '중개사 연결'],
  },
  {
    title: '데이터',
    links: ['실거래가 비교', '급매 리포트', '가격 검증 기준', '지역별 흐름'],
  },
  {
    title: '중개사',
    links: ['인증 중개사 신청', '매물 검증 요청', '파트너 센터', '광고 문의'],
  },
  {
    title: '회사',
    links: ['서비스 소개', '공지사항', '채용', '데이터 정책'],
  },
  {
    title: '고객지원',
    links: ['자주 묻는 질문', '허위매물 신고', '문의하기', '이용약관'],
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
            현재 가격과 데이터는 프론트엔드 프로토타입을 위한 예시입니다.
          </p>
        </div>

        <div className="footer-menu">
          {footerGroups.map((group) => (
            <div key={group.title} className="footer-column">
              <h3>{group.title}</h3>
              {group.links.map((link) => (
                <a key={link} href="#top">
                  {link}
                </a>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="footer-bottom">
        <span>© 2026 급매</span>
        <span>Supabase, 국토부 실거래가 API, Naver Map API 연결 예정</span>
      </div>
    </footer>
  );
}

export default Footer;
