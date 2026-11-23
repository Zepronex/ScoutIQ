import { BrowserRouter, Routes, Route, Link, NavLink, useLocation } from 'react-router-dom';
import { useEffect, useRef, Suspense, lazy } from 'react';
import GlobalPlayerSearch from './components/GlobalPlayerSearch';
import LoadingSpinner from './components/LoadingSpinner';
import { useSquad } from './state/useSquad';
import { usePlanning } from './state/usePlanning';
import HomePage from './pages/HomePage';
import SquadPage from './pages/SquadPage';
import TopPlayersPage from './pages/TopPlayersPage';

const AnalyzePage = lazy(() => import('./pages/AnalyzePage'));
const EvaluationPage = lazy(() => import('./pages/EvaluationPage'));
const PlayerDetailPage = lazy(() => import('./pages/PlayerDetailPage'));

const links = [
  ['/squad', 'Squad'],
  ['/top-players', 'Players'],
  ['/analyze', 'Gameweek plan'],
  ['/evaluation', 'Model']
];

function ScoutIQ() {
  const squad = useSquad();
  const planning = usePlanning();
  const { pathname } = useLocation();
  const main = useRef<HTMLElement>(null);
  const previousPath = useRef(pathname);

  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    window.scrollTo(0, 0);
    main.current?.focus({ preventScroll: true });
  }, [pathname]);

  return (
    <div className="min-h-screen">
      <a className="skip-link" href="#content">Skip to content</a>
      <header className="site-header">
        <div className="mx-auto grid max-w-7xl grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 px-4 pt-4 sm:px-6 lg:grid-cols-[auto_1fr_16rem] lg:gap-10 lg:py-0">
          <Link to="/" aria-label="ScoutIQ home" className="flex w-fit items-center gap-2 self-center py-1 text-xl font-bold tracking-tight text-white">
            <span className="brand-mark" aria-hidden="true"><span /></span>
            ScoutIQ
          </Link>
          <div className="min-w-0 lg:col-start-3 lg:row-start-1">
            <GlobalPlayerSearch />
          </div>
          <nav aria-label="Main navigation" className="col-span-2 mt-2 grid grid-cols-4 gap-1 lg:col-span-1 lg:col-start-2 lg:row-start-1 lg:mt-0 lg:flex">
            {links.map(([url, label]) => <NavLink key={url} className="nav-link" to={url}>{label}</NavLink>)}
          </nav>
        </div>
      </header>
      {planning.data?.source === 'sample' && (
        <p className="border-b border-amber-300 bg-amber-100 px-4 py-2 text-center text-sm font-semibold text-amber-950">
          Sample data for practice. Check the official FPL game before making changes.
        </p>
      )}
      <main ref={main} id="content" tabIndex={-1} className="mx-auto max-w-7xl px-4 py-6 outline-none sm:px-6 sm:py-10">
        <Suspense fallback={<LoadingSpinner text="Loading page…" />}>
          <Routes>
            <Route path="/" element={<HomePage planning={planning} />} />
            <Route path="/squad" element={<SquadPage squadState={squad} planning={planning} />} />
            <Route path="/top-players" element={<TopPlayersPage planning={planning} />} />
            <Route path="/analyze" element={<AnalyzePage squad={squad.squad} planning={planning} />} />
            <Route path="/evaluation" element={<EvaluationPage />} />
            <Route path="/player/:id" element={<PlayerDetailPage squadState={squad} planning={planning} />} />
            <Route path="*" element={<div className="card"><h1 className="page-title">Page not found</h1><Link className="text-link mt-3 inline-block" to="/">Return to ScoutIQ</Link></div>} />
          </Routes>
        </Suspense>
      </main>
      <footer className="mx-auto max-w-7xl px-4 py-8 text-sm text-slate-600 sm:px-6">
        ScoutIQ is an independent Fantasy Premier League planning tool.
      </footer>
    </div>
  );
}

export default function App() {
  return <BrowserRouter><ScoutIQ /></BrowserRouter>;
}
