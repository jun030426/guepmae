import { Link, NavLink } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';

const agentNavItems = [
  { label: '대시보드', path: '/agent/dashboard' },
  { label: '새 매물 등록', path: '/agent/properties/new' },
  { label: '내 등록 매물', path: '/agent/properties' },
  { label: '운영 관리', path: '/agent/admin' },
];

function AgentHeader() {
  const { isAuthenticated, profile, signOut } = useAuth();

  return (
    <header className="site-header agent-header">
      <div className="header-inner">
        <Link to="/agent" className="logo" aria-label="급매 중개사 portal">
          <span>급매</span>
          <em className="agent-badge">중개사</em>
        </Link>

        {isAuthenticated && profile?.role && ['agent', 'admin'].includes(profile.role) && (
          <nav className="desktop-nav" aria-label="중개사 메뉴">
            {agentNavItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
                end={item.path === '/agent/dashboard'}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        )}

        <div className="header-actions">
          <Link to="/" className="login-link" title="일반 사이트로 이동">
            <ExternalLink size={14} style={{ marginRight: 4 }} />
            일반 사이트
          </Link>
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
