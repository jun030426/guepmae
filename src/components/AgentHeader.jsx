import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

// 중개사(agent) 가 볼 수 있는 메뉴
// end: 하위 경로가 또 다른 메뉴인 항목은 정확히 일치할 때만 active 처리
//  (예: '/agent/properties' 는 '/agent/properties/new' 의 prefix라 end 필요)
const AGENT_NAV = [
  { label: '대시보드', path: '/agent/dashboard', end: true },
  { label: '새 매물 등록', path: '/agent/properties/new' },
  { label: '내 등록 매물', path: '/agent/properties', end: true },
];

// 관리자(admin) 만 추가로 보이는 메뉴
const ADMIN_ONLY_NAV = [
  { label: '운영 관리', path: '/agent/admin' },
];

function AgentHeader() {
  const { isAuthenticated, isOwner, isAdmin, isAgent, profile, signOut } = useAuth();

  const navItems = isAdmin ? [...AGENT_NAV, ...ADMIN_ONLY_NAV] : AGENT_NAV;
  const canSeeNav = isAuthenticated && (isAdmin || isAgent);
  const badgeLabel = isOwner ? '대표자' : isAdmin && profile?.role === 'admin' ? '관리자' : '중개사';

  return (
    <header className="site-header agent-header">
      <div className="header-inner">
        <Link to="/agent" className="logo" aria-label="급매 PRO">
          <span>급매</span>
          <em className="agent-badge">{badgeLabel}</em>
        </Link>

        {canSeeNav && (
          <nav className="desktop-nav" aria-label="중개사 메뉴">
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
                end={Boolean(item.end)}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        )}

        <div className="header-actions">
          {isAuthenticated ? (
            <>
              <span className="account-chip">{profile?.full_name || '중개사'}</span>
              <button type="button" className="login-link" onClick={signOut}>
                로그아웃
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="login-link">로그인</Link>
              <Link to="/agent/signup" className="agent-signup-button">중개사 가입</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export default AgentHeader;
