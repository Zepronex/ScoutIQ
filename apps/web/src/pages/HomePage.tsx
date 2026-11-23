import { Link } from 'react-router-dom';
import { ArrowRight, ListFilter, Users } from 'lucide-react';
import GameweekStatus from '../components/GameweekStatus';
import { PlanningState } from '../state/usePlanning';

export default function HomePage({ planning }: { planning: PlanningState }) {
  return (
    <div className="space-y-6">
      <section className="home-hero">
        <div className="relative z-10 max-w-2xl">
          <p className="text-sm font-semibold text-lime-200">Fantasy Premier League</p>
          <h1 className="mt-4 text-4xl font-bold leading-[1.05] tracking-tight text-white sm:text-6xl">Plan your gameweek.</h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-200 sm:text-lg">
            Pick your XI, choose a captain, and see whether a transfer is worth the points before the deadline.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link className="btn-primary" to="/squad">Open squad builder <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
            <Link className="btn-on-dark" to="/top-players">Browse projections</Link>
          </div>
        </div>
        <div className="pitch-lines" aria-hidden="true"><span /></div>
      </section>

      <GameweekStatus planning={planning} />

      <div className="grid gap-4 md:grid-cols-2">
        <Link className="feature-link" to="/squad">
          <Users className="h-6 w-6 text-fpl-green-dark" aria-hidden="true" />
          <div>
            <h2 className="text-lg font-semibold">Set up a squad</h2>
            <p className="mt-1 text-sm text-slate-600">Enter the players you own or generate a £100.0m draft to try out the planner.</p>
          </div>
          <ArrowRight className="ml-auto h-4 w-4 shrink-0" aria-hidden="true" />
        </Link>
        <Link className="feature-link" to="/top-players">
          <ListFilter className="h-6 w-6 text-fpl-green-dark" aria-hidden="true" />
          <div>
            <h2 className="text-lg font-semibold">Find a transfer target</h2>
            <p className="mt-1 text-sm text-slate-600">Compare projected points, prices and player availability for the same gameweek.</p>
          </div>
          <ArrowRight className="ml-auto h-4 w-4 shrink-0" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
