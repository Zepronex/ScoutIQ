import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Sparkles } from 'lucide-react';
import { apiClient, apiErrorMessage } from '../lib/api';
import { EnrichedPlayer } from '../lib/types';
import { validateSquadForAnalysis } from '../lib/squadValidation';
import ErrorMessage from '../components/ErrorMessage';
import LoadingSpinner from '../components/LoadingSpinner';
import EntryImport from '../components/EntryImport';
import GameweekStatus from '../components/GameweekStatus';
import SquadForm from '../components/SquadForm';
import { matchesSavedPlayer, SquadState, toSquadSlot } from '../state/useSquad';
import { PlanningState } from '../state/usePlanning';

export default function SquadPage({ squadState, planning }: { squadState: SquadState; planning: PlanningState }) {
  const { squad, dispatch } = squadState;
  const [catalog, setCatalog] = useState<EnrichedPlayer[]>([]);
  const [catalogError, setCatalogError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState('');
  const generation = useRef<AbortController>();
  const runId = planning.data?.gameweek?.runId;
  const sourceUpdatedAt = planning.data?.gameweek?.sourceUpdatedAt;
  const catalogRevision = useRef(sourceUpdatedAt);

  useEffect(() => {
    if (!sourceUpdatedAt) return;
    if (catalogRevision.current && catalogRevision.current !== sourceUpdatedAt) setRefresh(value => value + 1);
    catalogRevision.current = sourceUpdatedAt;
  }, [sourceUpdatedAt]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setCatalogError('');
    void apiClient.getPlayers(controller.signal).then(response => {
      if (controller.signal.aborted) return;
      if (!response.data?.length || !response.success) throw new Error('No players returned');
      setCatalog(response.data);
      dispatch({ type: 'catalog', players: new Map(response.data.map(player => [player.id, player])) });
    }).catch(error => {
      if (!controller.signal.aborted) setCatalogError(apiErrorMessage(error, 'Could not load the FPL player list.'));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [dispatch, refresh]);

  useEffect(() => {
    setGenerating(false);
    return () => generation.current?.abort();
  }, [runId]);

  const byId = useMemo(() => new Map(catalog.map(player => [player.id, player])), [catalog]);
  const players = [...squad.startingXI, ...squad.bench];
  const missing = catalog.length ? players.filter(slot => {
    const current = byId.get(slot.id);
    return !current || !matchesSavedPlayer(slot, current);
  }) : [];
  const validation = validateSquadForAnalysis(squad);
  const canAnalyze = validation.valid && !missing.length && !loading && !catalogError;
  const owned = squad.mode === 'existing';

  const generate = async () => {
    if (generation.current || !runId) return;
    const controller = new AbortController();
    generation.current = controller;
    setGenerationError('');
    setGenerating(true);
    try {
      const response = await apiClient.getSquadRecommendation({ budget: 100, predictionRunId: runId }, controller.signal);
      if (controller.signal.aborted || !response.data) return;
      const startingXI = response.data.startingXi.starters.map(slot => byId.get(slot.playerId)).filter((player): player is EnrichedPlayer => Boolean(player));
      const bench = response.data.startingXi.bench.map(slot => byId.get(slot.playerId)).filter((player): player is EnrichedPlayer => Boolean(player));
      if (startingXI.length !== 11 || bench.length !== 4) throw new Error('Catalog changed');
      dispatch({ type: 'replace', squad: {
        startingXI: startingXI.map(toSquadSlot), bench: bench.map(toSquadSlot), bank: response.data.squad.bank, mode: 'draft'
      } });
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = apiErrorMessage(error, 'Could not generate a draft. Try again or add players manually.');
        setGenerationError(message === 'planning_gameweek_changed' ? 'The gameweek data changed. Refresh the projections and try again.'
          : message === 'squad_generation_failed' ? 'A full draft could not be generated from the available projections. Add players manually.' : message);
      }
    } finally {
      if (generation.current === controller) {
        generation.current = undefined;
        if (!controller.signal.aborted) setGenerating(false);
      }
    }
  };

  const projections = useMemo(
    () => new Map((planning.data?.players ?? []).map(player => [player.playerId, player.predictedPoints])),
    [planning.data]
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Squad builder</h1>
          <p className="page-lede">Choose 15 players to review your lineup and transfer options.</p>
        </div>
        {canAnalyze ? <Link className="btn-primary" to="/analyze">Review gameweek plan <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
          : <button type="button" className="btn-primary" disabled>Review gameweek plan</button>}
      </header>
      <GameweekStatus planning={planning} />
      <fieldset disabled={generating} className="min-w-0 space-y-6">
        <section className="grid gap-x-10 gap-y-5 md:grid-cols-[auto_minmax(0,1fr)] md:items-start">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="squad-type" className="field-label">Squad type</label>
              <select id="squad-type" className="input-field mt-1 w-auto min-w-56" value={owned ? 'existing' : 'draft'}
                onChange={event => dispatch({ type: 'mode', mode: event.target.value === 'existing' ? 'existing' : 'draft' })}>
                <option value="draft">New draft · £100.0m</option>
                <option value="existing">My existing FPL squad</option>
              </select>
            </div>
            {!players.length && !owned && (
              <button type="button" className="btn-dark" disabled={!runId || loading || !!catalogError} onClick={generate}>
                <Sparkles className="h-4 w-4" aria-hidden="true" /> {generating ? 'Generating draft…' : 'Generate a draft'}
              </button>
            )}
            {!players.length && !owned && !runId && !planning.loading && (
              <p className="w-full text-sm text-ink-soft">Draft generation needs gameweek projections.</p>
            )}
          </div>
          {planning.data?.source === 'fpl' && (
            <EntryImport key={sourceUpdatedAt} replacing={players.length > 0}
              onImport={imported => dispatch({ type: 'replace', squad: imported })} />
          )}
        </section>
        {squadState.error && <ErrorMessage title="That change was not made" message={squadState.error} onDismiss={squadState.clearError} />}
        {generationError && <ErrorMessage message={generationError} action={{ label: 'Refresh projections', onClick: planning.reload }} />}
        {missing.length > 0 && <ErrorMessage type="warning" title="Saved players need replacing"
          message={`${missing.map(slot => slot.name ?? slot.id).join(', ')} no longer match the current FPL player list.`} />}
        {catalogError && <ErrorMessage title="Player list unavailable" message={catalogError} action={{ label: 'Retry player list', onClick: () => setRefresh(value => value + 1) }} />}
        {loading && <LoadingSpinner text="Loading FPL players…" />}
        <SquadForm squadState={squadState} players={catalogError || loading ? [] : catalog} projections={projections} />
      </fieldset>
      {!canAnalyze && players.length > 0 && (
        <p className="text-sm text-ink-soft" aria-live="polite">{validation.errors.join(' ')}</p>
      )}
      {canAnalyze && <Link className="btn-primary w-full sm:hidden" to="/analyze">Review gameweek plan</Link>}
    </div>
  );
}
