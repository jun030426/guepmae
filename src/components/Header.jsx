import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';

// 일반 사용자용 메인 네비. "집 내놓기"(매물 등록)는 중개사 portal(/agent)에서만 가능하므로 여기서 제거.
const navItems = [
  { label: '매물', path: '/properties' },
  { label: '지도 검색', path: '/map' },
  { label: '급매 리포트', path: '/report' },
];

function Header() {
  const [isOpen, setIsOpen] = useState(false);
  const { isAuthenticated, isAdmin, isAgent, profile, signOut } = useAuth();

  const closeMenu = () => setIsOpen(false);
  // agent/admin 로그인 사용자에겐 "중개사 portal" 바로가기 노출
  const visibleNavItems =
    isAdmin || isAgent
      ? [...navItems, { label: '중개사 portal', path: '/agent/dashboard' }]
      : navItems;

  const handleSignOut = async () => {
    await signOut();
    closeMenu();
  };

  return (
    <header className="site-header">
      <div className="header-inner">
        <Link to="/" className="logo" onClick={closeMenu} aria-label="급매 홈">
          <span>급매</span>
        </Link>

        <nav className="desktop-nav" aria-label="주요 메뉴">
          {visibleNavItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="header-actions">
          {isAuthenticated ? (
            <>
              <span className="account-chip">{profile?.full_name || '내 계정'}</span>
              <button type="button" className="login-link as-button" onClick={handleSignOut}>
                로그아웃
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="login-link">
                로그인 | 회원가입
              </Link>
              <Link to="/agent" className="agent-signup-button">
                중개사 가입
              </Link>
            </>
          )}
        </div>

        <button
          className="mobile-menu-button"
          type="button"
          aria-label="모바일 메뉴 열기"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((current) => !current)}
        >
          {isOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      <div className={isOpen ? 'mobile-nav open' : 'mobile-nav'}>
        {visibleNavItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) => (isActive ? 'mobile-nav-link active' : 'mobile-nav-link')}
            onClick={closeMenu}
          >
            {item.label}
          </NavLink>
        ))}
        <div className="mobile-auth-row">
          {isAuthenticated ? (
            <button type="button" onClick={handleSignOut}>
              로그아웃
            </button>
          ) : (
            <>
              <Link to="/login" onClick={closeMenu}>
                로그인 | 회원가입
              </Link>
              <Link to="/agent" onClick={closeMenu}>
                중개사 가입
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export default Header;
