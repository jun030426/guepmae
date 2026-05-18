import { Route, Routes, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import Header from './components/Header.jsx';
import Footer from './components/Footer.jsx';
import RequireRole from './components/RequireRole.jsx';
import Home from './pages/Home.jsx';
import Properties from './pages/Properties.jsx';
import MapPage from './pages/MapPage.jsx';
import PropertyDetail from './pages/PropertyDetail.jsx';
import Report from './pages/Report.jsx';
import RegisterProperty from './pages/RegisterProperty.jsx';
import Login from './pages/Login.jsx';
import Admin from './pages/Admin.jsx';
import AgentSignup from './pages/AgentSignup.jsx';

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

  return (
    <>
      <ScrollToTop />
      <Header />
      <main id="top" className={isFullViewport ? 'main-fullscreen' : undefined}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/properties" element={<Properties />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/properties/:id" element={<PropertyDetail />} />
          <Route path="/report" element={<Report />} />
          <Route path="/register" element={<RegisterProperty />} />
          <Route path="/login" element={<Login />} />
          <Route path="/agent-signup" element={<AgentSignup />} />
          <Route
            path="/admin"
            element={
              <RequireRole allowedRoles={['admin', 'agent']}>
                <Admin />
              </RequireRole>
            }
          />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
      {!isFullViewport && <Footer />}
    </>
  );
}

export default App;
