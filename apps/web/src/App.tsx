import { BrowserRouter, Routes, Route, Link, NavLink, useLocation } from 'react-router-dom';
import { useEffect, useRef, Suspense, lazy } from 'react';
import GlobalPlayerSearch from './components/GlobalPlayerSearch';
import LoadingSpinner from './components/LoadingSpinner';
import Logo from './components/Logo';
import { useSquad } from './state/useSquad';
import { usePlanning } from './state/usePlanning';
import HomePage from './pages/HomePage';
import SquadPage from './pages/SquadPage';
import TopPlayersPage from './pages/TopPlayersPage';

const AnalyzePage = lazy(() => import('./pages/AnalyzePage'));
const EvaluationPage = lazy(() => import('./pages/EvaluationPage'));
const PlayerDetailPage = lazy(() => import('./pages/PlayerDetailPage'));

// The third value is a shorter label for narrow screens.
const links: Array<[string, string, string?]> = [
  ['/squad', 'Squad'],
  ['/top-players', 'Players'],
  ['/analyze', 'Gameweek plan', 'Plan'],
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
    <div className="flex min-h-screen flex-col">
      <a className="skip-link" href="#content">Skip to content</a>
      <header className="site-header">
        <div className="mx-auto grid max-w-6xl grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 px-4 pt-3 sm:px-6 lg:grid-cols-[auto_1fr_15rem] lg:gap-8 lg:py-0">
          <Link to="/" aria-label="ScoutIQ home" className="brand">
            <Logo className="brand-mark" />
            ScoutIQ
          </Link>
          <div className="min-w-0 lg:col-start-3 lg:row-start-1">
            <GlobalPlayerSearch />
          </div>
          <nav aria-label="Main navigation" className="col-span-2 mt-1 grid grid-cols-4 gap-1 lg:col-span-1 lg:col-start-2 lg:row-start-1 lg:mt-0 lg:flex lg:gap-2">
            {links.map(([url, label, short]) => (
              <NavLink key={url} className="nav-link" to={url} aria-label={label}>
                {short ? <><span className="sm:hidden">{short}</span><span className="hidden sm:inline">{label}</span></> : label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      {planning.data?.source === 'sample' && (
        <p className="border-b border-amber/30 bg-amber-wash px-4 py-2 text-center text-sm font-semibold text-[#4d3400]">
          Sample data for practice. Check the official FPL game before making changes.
        </p>
      )}
      <main ref={main} id="content" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 outline-none sm:px-6 sm:py-10">
        <Suspense fallback={<LoadingSpinner text="Loading page…" />}>
          <Routes>
            <Route path="/" element={<HomePage planning={planning} />} />
            <Route path="/squad" element={<SquadPage squadState={squad} planning={planning} />} />
            <Route path="/top-players" element={<TopPlayersPage planning={planning} />} />
            <Route path="/analyze" element={<AnalyzePage squad={squad.squad} planning={planning} />} />
            <Route path="/evaluation" element={<EvaluationPage />} />
            <Route path="/player/:id" element={<PlayerDetailPage squadState={squad} planning={planning} />} />
            <Route path="*" element={
              <div className="py-10">
                <p className="eyebrow">Error 404</p>
                <h1 className="page-title mt-3">Page not found</h1>
                <p className="page-lede">That address does not match a ScoutIQ page.</p>
                <Link className="btn-dark mt-6" to="/">Return to ScoutIQ</Link>
              </div>
            } />
          </Routes>
        </Suspense>
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-start justify-between gap-x-10 gap-y-4 px-4 py-8 text-sm text-ink-soft sm:px-6">
          <p className="max-w-xl">
            ScoutIQ is an independent planning tool. It is not affiliated with the Premier League or Fantasy Premier League.
            Projections are estimates from public FPL data, so check the official game before you confirm a change.
          </p>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
            <Link className="text-link" to="/evaluation">How the model performs</Link>
            <a className="text-link" href="https://fantasy.premierleague.com/" rel="noreferrer noopener" target="_blank">Official FPL</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return <BrowserRouter><ScoutIQ /></BrowserRouter>;
}
