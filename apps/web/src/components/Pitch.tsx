import { Link } from 'react-router-dom';
import { OptimizerSquadSlot, Pos } from '../lib/types';
import { formatXp } from '../lib/format';

const ROWS: Array<{ position: Pos; label: string }> = [
  { position: 'GK', label: 'Goalkeeper' },
  { position: 'DEF', label: 'Defenders' },
  { position: 'MID', label: 'Midfielders' },
  { position: 'FWD', label: 'Forwards' }
];

type PitchProps = {
  starters: readonly OptimizerSquadSlot[];
  bench: readonly OptimizerSquadSlot[];
  captainId: number;
  viceCaptainId: number;
  fixtures?: ReadonlyMap<number, string[]>;
};

/**
 * The lineup drawn the way FPL draws it: goalkeeper at the top, forwards at the
 * bottom, substitutes in order underneath. Every name links to the player page.
 */
export default function Pitch({ starters, bench, captainId, viceCaptainId, fixtures }: PitchProps) {
  return (
    <div>
      <div className="pitch on-pitch px-1.5 py-4 sm:px-6 sm:py-7">
        <div className="pitch-markings" aria-hidden="true" />
        <div className="space-y-4 sm:space-y-6">
          {ROWS.map(row => (
            <ul key={row.position} aria-label={row.label} className="flex justify-center gap-1 sm:gap-3">
              {starters.filter(player => player.position === row.position).map(player => (
                <Token key={player.playerId} player={player} opponents={fixtures?.get(player.playerId)}
                  armband={player.playerId === captainId ? 'C' : player.playerId === viceCaptainId ? 'V' : undefined} />
              ))}
            </ul>
          ))}
        </div>
      </div>
      <div className="mt-2 rounded-lg bg-paper-sunk px-1.5 py-3 sm:px-6">
        <h3 className="eyebrow px-1.5 sm:px-0">Bench, in order</h3>
        <ol aria-label="Bench order" className="mt-2.5 flex justify-center gap-1 sm:gap-3">
          {bench.map((player, index) => (
            <Token key={player.playerId} player={player} opponents={fixtures?.get(player.playerId)} onBench
              order={player.position === 'GK' ? 'GK' : String(index + (bench[0]?.position === 'GK' ? 0 : 1))} />
          ))}
        </ol>
      </div>
    </div>
  );
}

function Token({ player, opponents, armband, onBench, order }: {
  player: OptimizerSquadSlot; opponents?: string[]; armband?: 'C' | 'V'; onBench?: boolean; order?: string;
}) {
  const flagged = player.availability === 'doubtful' || player.availability === 'unavailable';
  const fixture = player.fixtureCount === 0 ? 'No fixture' : opponents?.join(', ');
  return (
    <li className="pitch-token">
      <span className={`mb-1 flex h-5 items-center gap-1 text-[10px] font-bold uppercase tracking-wider ${onBench ? 'text-ink-faint' : 'text-white/75'}`}>
        {order ?? player.teamShortName}
        {armband && <span className="armband" title={armband === 'C' ? 'Captain' : 'Vice-captain'}>{armband}<span className="sr-only">{armband === 'C' ? ' (captain)' : ' (vice-captain)'}</span></span>}
        {flagged && <span className="h-2 w-2 rounded-full bg-[#ff8a6b]" title={player.availability === 'doubtful' ? 'Doubtful' : 'Unavailable'}><span className="sr-only">{player.availability}</span></span>}
      </span>
      <Link to={`/player/${player.playerId}`} title={player.playerName}
        className={`pitch-token-name hover:underline ${onBench ? 'border border-b-0 border-line bg-white' : ''}`}>
        {player.shortName ?? player.playerName}
      </Link>
      <span className={`pitch-token-meta ${onBench ? 'bg-ink/85' : ''}`}>
        <span className="font-bold">{formatXp(player.predictedPoints)}</span>
        {fixture && <span className="hidden text-white/70 sm:inline"> · {fixture}</span>}
      </span>
      {onBench && <span className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{player.position} · {player.teamShortName}</span>}
    </li>
  );
}
