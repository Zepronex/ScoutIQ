import { EnrichedPlayer } from '../lib/types';
import { formatOnePlace } from '../lib/format';

const twoPlaces = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PlayerStats({ player }: { player: EnrichedPlayer }) {
  const stats: Array<{ label: string; value: string; note: string }> = [
    { label: 'Form', value: formatOnePlace(player.form), note: 'Average points over the last 30 days' },
    { label: 'Points per game', value: formatOnePlace(player.avgPoints), note: 'Across matches played this season' },
    { label: 'xG per 90', value: twoPlaces.format(player.xg90), note: 'Expected goals per 90 minutes' },
    { label: 'xA per 90', value: twoPlaces.format(player.xa90), note: 'Expected assists per 90 minutes' },
    { label: 'Minutes per start', value: player.expMin > 0 ? formatOnePlace(player.expMin) : '—', note: 'Season average' },
    {
      label: 'Next three fixtures',
      value: player.next3Ease > 0 ? formatOnePlace(player.next3Ease) : '—',
      note: 'Average FPL difficulty, 1 easiest to 5 hardest'
    }
  ];
  return (
    <dl className="mt-4 grid grid-cols-2 border-t border-line md:grid-cols-3">
      {stats.map(stat => (
        <div key={stat.label} className="border-b border-line py-4 pr-4">
          <dt className="eyebrow">{stat.label}</dt>
          <dd className="figure mt-2 text-3xl leading-none">{stat.value}</dd>
          <dd className="mt-1.5 text-[13px] text-ink-faint">{stat.note}</dd>
        </div>
      ))}
    </dl>
  );
}
