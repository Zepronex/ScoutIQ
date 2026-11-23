import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient, apiErrorMessage } from '../lib/api';
import { OptimizerSquadInput, Squad, SquadAnalysis, StartingXIOptimizerResult, TransferRecommendation } from '../lib/types';
import { formatPoints, formatPrice } from '../lib/format';
import { PlanningState } from '../state/usePlanning';
import ErrorMessage from '../components/ErrorMessage';
import GameweekStatus from '../components/GameweekStatus';
import LoadingSpinner from '../components/LoadingSpinner';
import OptimizerRecommendations from '../components/OptimizerRecommendations';

function readOptimizerError(error: unknown, fallback: string) {
  const message = apiErrorMessage(error, fallback);
  const messages: Record<string, string> = {
    planning_gameweek_changed: 'A newer gameweek snapshot is available. Refresh the gameweek data to continue.',
    no_planning_predictions: 'Projections for the next deadline are unavailable.',
    squad_predictions_missing: 'One or more players are missing a projection. Try again after the next data refresh.',
    invalid_squad: 'The squad failed a rule check. Review your saved players and budget.',
    invalid_selling_price: 'A selling price is above the current market price. Update it in the squad builder.',
    selling_prices_required: 'Enter your bank and every selling price in the squad builder to check transfer affordability.',
    bank_required: 'Enter your current bank balance in the squad builder.'
  };
  return messages[message] ?? message;
}

function validMoney(value: number | undefined, min: number, max: number): value is number {
  return value !== undefined && Number.isFinite(value) && value >= min && value <= max &&
    Math.abs(Math.round(value * 10) - value * 10) < 1e-8;
}

function optimizerInput(squad: Squad, analysis: SquadAnalysis): OptimizerSquadInput {
  const existingSquad = squad.mode === 'existing';
  return {
    playerIds: analysis.results.map(result => result.player.id),
    bank: existingSquad ? (validMoney(squad.bank, 0, 100) ? squad.bank : 0) : analysis.bankLeft,
    existingSquad
  };
}

export default function AnalyzePage({ squad, planning }: { squad: Squad; planning: PlanningState }) {
  const [analysis, setAnalysis] = useState<SquadAnalysis>();
  const [analysisError, setAnalysisError] = useState('');
  const [analysisRetry, setAnalysisRetry] = useState(0);
  const [lineup, setLineup] = useState<StartingXIOptimizerResult>();
  const [lineupError, setLineupError] = useState('');
  const [lineupRetry, setLineupRetry] = useState(0);
  const [transferOptions, setTransferOptions] = useState<TransferRecommendation[]>();
  const [transferError, setTransferError] = useState('');
  const [loadingTransfers, setLoadingTransfers] = useState(false);
  const owned = squad.mode === 'existing';
  const [freeTransfers, setFreeTransfers] = useState<number | ''>(owned ? '' : 1);
  const [hits, setHits] = useState(0);
  const transferRequest = useRef<AbortController>();
  const runId = planning.data?.gameweek?.runId;
  const updatedAt = planning.data?.gameweek?.sourceUpdatedAt;
  const analysisRevision = useRef(updatedAt);
  const complete = squad.startingXI.length === 11 && squad.bench.length === 4;

  useEffect(() => {
    if (!updatedAt) return;
    if (analysisRevision.current && analysisRevision.current !== updatedAt) setAnalysisRetry(value => value + 1);
    analysisRevision.current = updatedAt;
  }, [updatedAt]);

  useEffect(() => {
    setAnalysis(undefined);
    setAnalysisError('');
    if (!complete) return;
    const controller = new AbortController();
    const request = { ...squad, bank: owned && !validMoney(squad.bank, 0, 100) ? 0 : Math.max(0, squad.bank) };
    if (owned) {
      const sanitize = (slot: Squad['bench'][number]) => ({
        ...slot, sellingPrice: validMoney(slot.sellingPrice, 0.1, slot.price) ? slot.sellingPrice : undefined
      });
      request.startingXI = squad.startingXI.map(sanitize);
      request.bench = squad.bench.map(sanitize);
    }
    void apiClient.analyzeSquad(request, controller.signal).then(response => {
      if (controller.signal.aborted) return;
      if (response.success && response.data) setAnalysis(response.data);
      else setAnalysisError(response.error ?? 'Could not review the squad.');
    }).catch(error => {
      if (!controller.signal.aborted) setAnalysisError(apiErrorMessage(error, 'Could not review the squad.'));
    });
    return () => controller.abort();
  }, [squad, complete, owned, analysisRetry]);

  useEffect(() => {
    setLineup(undefined);
    setLineupError('');
    if (!analysis || !runId) return;
    const controller = new AbortController();
    void apiClient.getStartingXIRecommendation({
      squad: optimizerInput(squad, analysis),
      predictionRunId: runId
    }, controller.signal).then(response => {
      if (!controller.signal.aborted) setLineup(response.data);
    }).catch(error => {
      if (!controller.signal.aborted) setLineupError(readOptimizerError(error, 'Could not calculate a lineup. Try again shortly.'));
    });
    return () => controller.abort();
  }, [analysis, runId, lineupRetry, squad]);

  const clearTransfers = () => {
    transferRequest.current?.abort();
    transferRequest.current = undefined;
    setTransferOptions(undefined);
    setTransferError('');
    setLoadingTransfers(false);
  };

  useEffect(() => {
    clearTransfers();
    return () => transferRequest.current?.abort();
  }, [analysis, runId, lineupRetry]);

  const slots = [...squad.startingXI, ...squad.bench];
  const sellingPrices = Object.fromEntries(slots.map(slot => [slot.id, slot.sellingPrice]));
  const bankConfirmed = squad.bankConfirmed && validMoney(squad.bank, 0, 100);
  const pricesComplete = analysis?.results.every(({ player }) => validMoney(sellingPrices[player.id], 0.1, player.price));
  const validFinances = !owned || Boolean(bankConfirmed && pricesComplete);
  const currentLineup = runId && lineup?.predictionRunIds.includes(runId) ? lineup : undefined;
  const clubCounts = new Map<number, number>();
  for (const { player } of analysis?.results ?? []) clubCounts.set(player.teamId, (clubCounts.get(player.teamId) ?? 0) + 1);

  const compare = async () => {
    if (freeTransfers === '' || !analysis || !runId || !currentLineup || !validFinances || transferRequest.current) return;
    if (freeTransfers === 0 && hits === 0) {
      setTransferOptions([]);
      return;
    }
    const controller = new AbortController();
    transferRequest.current = controller;
    setTransferOptions(undefined);
    setTransferError('');
    setLoadingTransfers(true);
    try {
      const currentSquad = optimizerInput(squad, analysis);
      if (owned) currentSquad.sellingPrices = sellingPrices as Record<number, number>;
      const response = await apiClient.getTransferRecommendations({
        currentSquad, freeTransfers, maxHits: hits, predictionRunId: runId
      }, controller.signal);
      if (!controller.signal.aborted) setTransferOptions(response.data?.recommendations ?? []);
    } catch (error) {
      if (!controller.signal.aborted) setTransferError(readOptimizerError(error, 'Could not compare transfers. Try again shortly.'));
    } finally {
      if (transferRequest.current === controller) {
        transferRequest.current = undefined;
        setLoadingTransfers(false);
      }
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Gameweek plan</h1>
          <p className="mt-2 text-slate-600">Review your best projected XI, captaincy and transfer options for the next deadline.</p>
        </div>
        <Link to="/squad" className="btn-secondary">Edit squad</Link>
      </div>
      <GameweekStatus planning={planning} />

      {!complete ? <section className="card">
        <h2 className="text-xl font-semibold">Complete your squad first</h2>
        <p className="mt-2 text-sm text-slate-600">{slots.length} of 15 players saved. Add players to fill the starting XI and bench.</p>
        <Link to="/squad" className="btn-primary mt-4">Open squad builder</Link>
      </section> : analysisError ? <ErrorMessage title="Squad review unavailable" message={analysisError}
        action={{ label: 'Retry squad review', onClick: () => setAnalysisRetry(value => value + 1) }} />
        : !analysis ? <LoadingSpinner text="Reviewing your squad…" /> : (
          <>
            {owned && [...clubCounts.values()].some(count => count > 3) && (
              <ErrorMessage type="warning" title="Club limit exceeded"
                message="Your existing lineup is available. Any recommended transfer plan must bring each club back to three players or fewer." />
            )}
            <OptimizerRecommendations
              startingXi={currentLineup?.startingXi}
              transferRecommendations={currentLineup ? transferOptions : undefined}
              isLoading={planning.loading || Boolean(runId && !currentLineup && !lineupError)}
              error={lineupError}
              onRetry={() => setLineupRetry(value => value + 1)}
              emptyMessage="The next deadline has no projections yet. Your saved squad and FPL statistics are available."
              targetGameweekId={currentLineup?.targetGameweekId}
              predictionRunIds={currentLineup?.predictionRunIds}
              transferControls={currentLineup && (
                <section className="card space-y-4" aria-labelledby="transfer-planner">
                  <h2 id="transfer-planner" className="text-xl font-semibold">Compare transfers</h2>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="font-semibold">Keep squad · {formatPoints(currentLineup.startingXi.totalPredictedPoints)} projected pts</p>
                    <p className="mt-1 text-sm text-slate-600">0 transfers, 0 points spent. This is the baseline for every comparison.</p>
                  </div>
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="min-w-28 text-sm font-semibold">
                      <label htmlFor="plan-free-transfers">Free transfers</label>
                      <select id="plan-free-transfers" className="input-field mt-1" value={freeTransfers} onChange={event => {
                        clearTransfers();
                        setFreeTransfers(event.target.value === '' ? '' : Number(event.target.value));
                      }}>
                        <option value="" disabled>Select</option>
                        {[0, 1, 2, 3, 4, 5].map(value => <option key={value}>{value}</option>)}
                      </select>
                    </div>
                    <div className="min-w-32 text-sm font-semibold">
                      <label htmlFor="plan-max-hit">Maximum hit</label>
                      <select id="plan-max-hit" className="input-field mt-1" value={hits} onChange={event => {
                        clearTransfers();
                        setHits(Number(event.target.value));
                      }}>
                        <option value="0">No hit</option><option value="1">4 points</option><option value="2">8 points</option>
                      </select>
                    </div>
                    <button className="btn-primary" type="button" onClick={compare}
                      disabled={loadingTransfers || freeTransfers === '' || !validFinances}>
                      {loadingTransfers ? 'Comparing…' : 'Compare transfers'}
                    </button>
                  </div>
                  {!validFinances && (
                    <p className="text-sm text-amber-900">Enter a current bank balance and valid selling prices for all 15 players in <Link to="/squad" className="text-link">Edit squad</Link>.</p>
                  )}
                  <p className="text-sm text-slate-600">
                    ScoutIQ compares up to two moves over this gameweek. {owned ? 'Costs use your confirmed selling prices.' : 'This draft uses market prices for both sales and purchases.'}
                  </p>
                  {transferError && <ErrorMessage message={transferError} action={{ label: 'Retry transfers', onClick: compare }} />}
                </section>
              )}
            />
            <details className="card">
              <summary className="cursor-pointer font-semibold">Saved squad and season form</summary>
              <div className="mt-3">
                <p className="mb-2 text-sm text-slate-600">
                  {owned && !bankConfirmed ? 'Bank unconfirmed' : `${formatPrice(analysis.bankLeft)} in the bank`}
                </p>
                <ul className="divide-y divide-slate-100">
                  {analysis.results.map(({ player }, index) => (
                    <li key={player.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 text-sm">
                      <Link className="text-link font-semibold" to={`/player/${player.id}`}>{player.name}</Link>
                      <span className="text-slate-600">{index < 11 ? 'XI' : 'Bench'} · {player.pos} · {player.form.toFixed(1)} form</span>
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          </>
        )}
    </div>
  );
}
