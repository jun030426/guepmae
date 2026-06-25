import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import Header from './components/Header.jsx';
import AgentHeader from './components/AgentHeader.jsx';
import Footer from './components/Footer.jsx';
import RequireRole from './components/RequireRole.jsx';
import Home from './pages/Home.jsx';
import Properties from './pages/Properties.jsx';
import MapPage from './pages/MapPage.jsx';
import PropertyDetail from './pages/PropertyDetail.jsx';
import Report from './pages/Report.jsx';
import Login from './pages/Login.jsx';
import Admin from './pages/Admin.jsx';
import AgentSignup from './pages/AgentSignup.jsx';
import AgentLanding from './pages/AgentLanding.jsx';
import AgentDashboard from './pages/AgentDashboard.jsx';
import AgentRegisterProperty from './pages/AgentRegisterProperty.jsx';
import AgentMyProperties from './pages/AgentMyProperties.jsx';
import AgentEditProperty from './pages/AgentEditProperty.jsx';

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [pathname]);

  return null;
}

function App() {
  const { pathname } = useLocation();
  const isFullViewport = pathname === '/map';
  const isAgentArea = pathname.startsWith('/agent');

  return (
    <>
      <ScrollToTop />
      {isAgentArea ? <AgentHeader /> : <Header />}
      <main id="top" className={isFullViewport ? 'main-fullscreen' : undefined}>
        <Routes>
          {/* ----------------------------- 일반 사용자 ----------------------------- */}
          <Route path="/" element={<Home />} />
          <Route path="/properties" element={<Properties />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/properties/:id" element={<PropertyDetail />} />
          <Route path="/report" element={<Report />} />
          <Route path="/login" element={<Login />} />

          {/* ----------------------------- 중개사 portal ----------------------------- */}
          <Route path="/agent" element={<AgentLanding />} />
          <Route path="/agent/signup" element={<AgentSignup />} />
          {/* 옛 경로 호환 — /agent-signup → /agent/signup */}
          <Route path="/agent-signup" element={<Navigate to="/agent/signup" replace />} />
          <Route
            path="/agent/dashboard"
            element={
              <RequireRole allowedRoles={['admin', 'agent']}>
                <AgentDashboard />
              </RequireRole>
            }
          />
          <Route
            path="/agent/properties/new"
            element={
              <RequireRole allowedRoles={['admin', 'agent']}>
                <AgentRegisterProperty />
              </RequireRole>
            }
          />
          <Route
            path="/agent/properties/:id/edit"
            element={
              <RequireRole allowedRoles={['admin', 'agent']}>
                <AgentEditProperty />
              </RequireRole>
            }
          />
          <Route
            path="/agent/properties"
            element={
              <RequireRole allowedRoles={['admin', 'agent']}>
                <AgentMyProperties />
              </RequireRole>
            }
          />
          <Route
            path="/agent/admin"
            element={
              <RequireRole allowedRoles={['admin']}>
                <Admin />
              </RequireRole>
            }
          />

          {/* ----------------------------- 옛 /admin — 운영팀(admin)만 ----------------------------- */}
          <Route
            path="/admin"
            element={
              <RequireRole allowedRoles={['admin']}>
                <Admin />
              </RequireRole>
            }
          />

          <Route path="*" element={<Home />} />
        </Routes>
      </main>
      {!isFullViewport && !isAgentArea && <Footer />}
    </>
  );
}

export default App;
