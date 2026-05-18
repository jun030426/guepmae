import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

function RequireRole({ allowedRoles, children }) {
  const { isLoading, isAuthenticated, profile } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="page-shell">
        <section className="container empty-state detail-empty">
          <h1>권한을 확인하고 있습니다.</h1>
          <p>잠시만 기다려주세요.</p>
        </section>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!allowedRoles.includes(profile?.role)) {
    return (
      <div className="page-shell">
        <section className="container empty-state detail-empty">
          <h1>접근 권한이 없습니다.</h1>
          <p>이 화면은 승인된 운영 계정만 사용할 수 있습니다.</p>
        </section>
      </div>
    );
  }

  return children;
}

export default RequireRole;
