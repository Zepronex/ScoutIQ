import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { PlanningState } from '../state/usePlanning';
import { formatCountdown, formatDateTime, formatXp, formatPrice, formatShortDateTime } from '../lib/format';

const steps = [
  { to: '/squad', title: 'Enter your squad', text: 'Search for your 15 players, import your public FPL picks by team ID, or generate a £100.0m draft.' },
  { to: '/analyze', title: 'Get your XI and captain', text: 'See the highest-scoring legal lineup, bench order and armband for the next deadline.' },
  { to: '/analyze', title: 'Test a transfer', text: 'Compare one or two moves against keeping your squad, with points hits and your real selling prices counted.' }
];

export default function HomePage({ planning }: { planning: PlanningState }) {
  const gameweek = planning.data?.gameweek;
  const players = planning.data?.players ?? [];
  const ready = gameweek?.runId != null && players.length > 0;
  const top = [...players].sort((a, b) => b.predictedPoints - a.predictedPoints).slice(0, 8);
  const countdown = gameweek ? formatCountdown(gameweek.deadline) : null;

  return (
    <div className="space-y-10 sm:space-y-14">
      <section className="hero on-pitch">
        <div className="hero-pitch" aria-hidden="true" />
        <div className="grid gap-8 px-5 py-9 sm:px-10 sm:py-14 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] md:items-end">
          <div>
            <p className="eyebrow text-lime">Fantasy Premier League planner</p>
            <h1 className="display mt-4 text-[2.75rem] leading-[0.95] sm:text-7xl">Plan your gameweek.</h1>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-white/85 sm:text-lg">
              Pick your XI, choose a captain, and see whether a transfer is worth the points before the deadline.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link className="btn-primary" to="/squad">Open squad builder <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
              <Link className="btn-on-dark" to="/top-players">Browse projections</Link>
            </div>
          </div>
          <div className="border-t border-white/20 pt-5 md:border-l md:border-t-0 md:pl-8 md:pt-0" role="status">
            <p className="eyebrow text-white/70">
              {gameweek ? `Gameweek ${gameweek.id}${gameweek.season ? ` · ${gameweek.season}` : ''}`
                : planning.loading ? 'Checking the FPL schedule…' : planning.error ? 'FPL schedule unavailable' : 'No open FPL gameweek'}
            </p>
            {gameweek ? <>
              <p className="figure mt-3 text-4xl leading-none sm:text-5xl">{countdown ?? 'Deadline passed'}</p>
              <p className="mt-2 text-sm text-white/80">
                {countdown ? 'until the deadline' : 'Waiting for the next gameweek'} · {formatDateTime(gameweek.deadline)}
              </p>
              <p className="mt-4 text-xs text-white/60">
                {planning.data?.source === 'sample' ? 'Sample data' : 'Official FPL snapshot'} from {formatShortDateTime(gameweek.sourceUpdatedAt)}
              </p>
            </> : <p className="mt-3 text-sm text-white/80">{planning.error ?? 'You can still build and save a squad.'}</p>}
          </div>
        </div>
      </section>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-14">
        <section aria-labelledby="top-projections">
          <div className="rule-heading">
            <h2 id="top-projections" className="section-title">
              {gameweek ? `Top projections for Gameweek ${gameweek.id}` : 'Top projections'}
            </h2>
            <Link className="text-link shrink-0 text-sm font-semibold" to="/top-players">All players</Link>
          </div>
          {ready ? (
            <ol>
              {top.map((player, index) => (
                <li key={player.playerId} className="flex items-center gap-3 border-b border-line py-2.5">
                  <span className="figure w-6 text-right text-sm text-ink-faint">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <Link className="font-semibold text-ink hover:text-pitch-turf" to={`/player/${player.playerId}`}>{player.playerName}</Link>
                    <p className="text-[13px] text-ink-soft">
                      {player.teamShortName} · {player.position} · {formatPrice(player.price)}
                      {player.opponents?.length ? <> · v {player.opponents.join(', ')}</> : null}
                    </p>
                  </div>
                  <span className="figure text-lg text-ink">{formatXp(player.predictedPoints)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="py-6 text-sm text-ink-soft">
              {planning.loading ? 'Loading projections…' : 'Projections for the next deadline are not available yet.'}
            </p>
          )}
          <p className="mt-3 text-[13px] text-ink-faint">Projected points for the gameweek. <Link className="text-link" to="/evaluation">How accurate are these?</Link></p>
        </section>

        <section aria-labelledby="how-it-works">
          <div className="rule-heading">
            <h2 id="how-it-works" className="section-title">How it works</h2>
          </div>
          <ol>
            {steps.map((step, index) => (
              <li key={step.title} className="border-b border-line">
                <Link to={step.to} className="group flex gap-4 py-4">
                  <span className="figure text-3xl leading-none text-line-strong group-hover:text-pitch-turf">{index + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-ink group-hover:text-pitch-turf">{step.title}</span>
                    <span className="mt-1 block text-sm leading-relaxed text-ink-soft">{step.text}</span>
                  </span>
                  <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-ink-faint group-hover:text-pitch-turf" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-[13px] text-ink-faint">Your squad is saved in this browser. No account is needed.</p>
        </section>
      </div>
    </div>
  );
}
