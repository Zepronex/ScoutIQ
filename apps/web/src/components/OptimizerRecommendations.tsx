import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import {
  ConstraintValidationResult,
  RecommendationExplanation,
  StartingXIRecommendation,
  TransferRecommendation
} from '../lib/types';
import { formatPoints, formatPrice, formatSigned, formatXp } from '../lib/format';
import ErrorMessage from './ErrorMessage';
import LoadingSpinner from './LoadingSpinner';
import Pitch from './Pitch';
import { apiClient, apiErrorMessage } from '../lib/api';

type OptimizerRecommendationsProps = {
  startingXi?: StartingXIRecommendation;
  transferRecommendations?: TransferRecommendation[];
  transferControls?: ReactNode;
  isLoading?: boolean;
  error?: string | null;
  emptyMessage: string;
  onRetry?: () => void;
  targetGameweekId?: number;
  predictionRunIds?: number[];
  /** Gameweek fixtures by player id, shown on the pitch. */
  fixtures?: ReadonlyMap<number, string[]>;
};

export default function OptimizerRecommendations({
  startingXi, transferRecommendations, transferControls, isLoading, error, emptyMessage, onRetry,
  targetGameweekId, predictionRunIds, fixtures
}: OptimizerRecommendationsProps) {
  const [explanation, setExplanation] = useState<RecommendationExplanation | null>(null);
  const [explanationError, setExplanationError] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);
  const request = useRef<AbortController>();
  useEffect(() => {
    setExplanation(null);
    setExplanationError(null);
    setExplaining(false);
    return () => {
      request.current?.abort();
      request.current = undefined;
    };
  }, [startingXi, transferRecommendations, targetGameweekId, predictionRunIds]);

  const explain = async () => {
    if (!startingXi || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setExplaining(true);
    setExplanationError(null);
    try {
      const response = await apiClient.explainRecommendation({
        optimizerResult: {
          startingXi,
          transferRecommendations: transferRecommendations ?? [],
          targetGameweekId,
          predictionRunIds: predictionRunIds ?? []
        }
      }, controller.signal);
      if (!response.success || !response.data) throw new Error('Missing explanation');
      if (!controller.signal.aborted) setExplanation(response.data);
    } catch (error) {
      if (!controller.signal.aborted) setExplanationError(apiErrorMessage(error, 'Could not load the explanation. Try again.'));
    } finally {
      if (request.current === controller) {
        request.current = undefined;
        setExplaining(false);
      }
    }
  };

  if (isLoading) return <LoadingSpinner text="Calculating the lineup…" />;
  if (error) return <ErrorMessage title="Lineup unavailable" message={error}
    action={onRetry ? { label: 'Retry lineup', onClick: onRetry } : undefined} />;
  if (!startingXi) return <ErrorMessage type="info" title="No lineup projection" message={emptyMessage} />;

  return (
    <div className="space-y-12">
      <StartingXiSection recommendation={startingXi} fixtures={fixtures} />
      {transferControls}
      {transferRecommendations && (
        transferRecommendations.length > 0
          ? <TransfersSection recommendations={transferRecommendations} beforePoints={startingXi.totalPredictedPoints} />
          : <ErrorMessage type="info" title="Keep your squad this gameweek"
            message="No transfer within your settings improves the projected lineup after points hits." />
      )}
      <section aria-label="Explanation">
        {explaining ? <LoadingSpinner text="Writing the explanation…" />
          : explanationError ? <ErrorMessage type="warning" title="Explanation unavailable" message={explanationError}
            action={{ label: 'Retry explanation', onClick: explain }} />
          : explanation ? <ExplanationPanel explanation={explanation} />
          : (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-line pt-6">
              <button className="btn-secondary" type="button" onClick={explain}>Explain this plan</button>
              <p className="text-sm text-ink-soft">A written summary of the lineup, captaincy and transfer reasoning.</p>
            </div>
          )}
      </section>
    </div>
  );
}

function StartingXiSection({ recommendation, fixtures }: {
  recommendation: StartingXIRecommendation; fixtures?: ReadonlyMap<number, string[]>;
}) {
  const { captaincy } = recommendation;
  const flagged = [...recommendation.starters, ...recommendation.bench]
    .filter(player => player.availability === 'doubtful' || player.availability === 'unavailable');

  return (
    <section aria-labelledby="starting-xi">
      <div className="rule-heading">
        <h2 id="starting-xi" className="section-title">Recommended starting XI</h2>
        <RuleCheck validation={recommendation.constraintSummary} />
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 py-5 sm:grid-cols-4">
        <Stat label="Projected points" value={formatPoints(recommendation.totalPredictedPoints)} note="captain counted twice" large />
        <Stat label="Formation" value={recommendation.formation} large />
        <Stat label="Captain" value={captaincy.captain.shortName ?? captaincy.captain.playerName}
          note={`${formatXp(captaincy.captainPredictedPoints)} projected`} />
        <Stat label="Vice-captain" value={captaincy.viceCaptain.shortName ?? captaincy.viceCaptain.playerName}
          note={`${formatXp(captaincy.viceCaptainPredictedPoints)} projected`} />
      </dl>
      {flagged.length > 0 && (
        <div className="notice notice-warning mb-5">
          <p><span className="font-semibold">Check availability.</span> {flagged.map(player => player.shortName ?? player.playerName).join(', ')}
            {flagged.length === 1 ? ' is' : ' are'} flagged as doubtful or unavailable in the FPL data.</p>
        </div>
      )}
      <Pitch starters={recommendation.starters} bench={recommendation.bench} fixtures={fixtures}
        captainId={captaincy.captain.playerId} viceCaptainId={captaincy.viceCaptain.playerId} />
      <RuleViolations validation={recommendation.constraintSummary} />
    </section>
  );
}

function Stat({ label, value, note, large }: { label: string; value: string; note?: string; large?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow">{label}</dt>
      <dd className={`figure mt-2 truncate leading-none ${large ? 'text-4xl' : 'text-2xl sm:text-[1.7rem]'}`}>{value}</dd>
      {note && <dd className="mt-1.5 text-[13px] text-ink-soft">{note}</dd>}
    </div>
  );
}

function RuleCheck({ validation }: { validation: ConstraintValidationResult }) {
  return validation.valid
    ? <span className="shrink-0 text-[13px] text-ink-soft">Passes all {validation.checks.length} squad rules</span>
    : <span className="shrink-0 text-[13px] font-semibold text-clay">{validation.violations.length} rule {validation.violations.length === 1 ? 'issue' : 'issues'}</span>;
}

function RuleViolations({ validation }: { validation: ConstraintValidationResult }) {
  if (validation.valid) return null;
  return (
    <div className="notice notice-error mt-4">
      <p className="font-semibold">This lineup breaks an FPL rule</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {validation.violations.slice(0, 3).map(violation => (
          <li key={`${violation.code}-${violation.key}`}>
            {humanizeKey(violation.key)}: expected {formatConstraintValue(violation.expected)}, got {formatConstraintValue(violation.actual)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TransfersSection({ recommendations, beforePoints }: { recommendations: TransferRecommendation[]; beforePoints: number }) {
  const ranked = [...recommendations].sort((a, b) => b.netExpectedPointsGain - a.netExpectedPointsGain || a.transferCount - b.transferCount);
  return (
    <section aria-labelledby="transfer-options">
      <div className="rule-heading">
        <h2 id="transfer-options" className="section-title">Recommended transfer options</h2>
        <span className="shrink-0 text-[13px] text-ink-soft">Ranked by net gain</span>
      </div>
      <ol>
        {ranked.map((recommendation, index) => (
          <li key={recommendation.moves.map(move => `${move.playerOut.playerId}-${move.playerIn.playerId}`).join('|')}
            className="grid gap-x-8 gap-y-4 border-b border-line py-5 md:grid-cols-[9rem_minmax(0,1fr)]">
            <div>
              <p className="eyebrow">{index === 0 ? 'Best option' : `Option ${index + 1}`}</p>
              <p className={`figure mt-2 text-4xl leading-none ${recommendation.netExpectedPointsGain > 0 ? 'text-pitch-turf' : 'text-ink'}`}>
                {formatSigned(recommendation.netExpectedPointsGain)}
              </p>
              <p className="mt-1.5 text-[13px] text-ink-soft">
                net points, {recommendation.transferCount} {recommendation.transferCount === 1 ? 'transfer' : 'transfers'}
              </p>
            </div>
            <div className="min-w-0">
              <ul className="space-y-2">
                {recommendation.moves.map(move => (
                  <li key={`${move.playerOut.playerId}-${move.playerIn.playerId}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
                    <TransferPlayer label="Sell" name={move.playerOut.playerName} points={move.playerOut.predictedPoints}
                      price={move.playerOut.sellingPrice ?? move.playerOut.price} />
                    <ArrowRight className="h-4 w-4 text-ink-faint" aria-hidden="true" />
                    <TransferPlayer label="Buy" name={move.playerIn.playerName} points={move.playerIn.predictedPoints} price={move.playerIn.price} />
                  </li>
                ))}
              </ul>
              <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-ink-soft">
                <Fact label="Gain before hit" value={formatSigned(recommendation.expectedPointsGain)} />
                <Fact label="Points hit" value={recommendation.pointsHit ? `−${recommendation.pointsHit}` : 'None'} />
                <Fact label="Bank after" value={formatPrice(recommendation.bankAfterTransfers)} />
                <Fact label="Projected XI" value={`${formatPoints(beforePoints)} → ${formatPoints(recommendation.startingXi.totalPredictedPoints)}`} />
              </dl>
              <RuleViolations validation={recommendation.validation} />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="flex gap-1.5"><dt>{label}</dt><dd className="font-semibold tabular-nums text-ink">{value}</dd></div>;
}

function TransferPlayer({ label, name, points, price }: { label: string; name: string; points: number; price: number }) {
  return (
    <div className="min-w-0">
      <p className="eyebrow">{label}</p>
      <p className="mt-1 truncate font-semibold" title={name}>{name}</p>
      <p className="text-[13px] tabular-nums text-ink-soft">{formatXp(points)} pts · {formatPrice(price)}</p>
    </div>
  );
}

function ExplanationPanel({ explanation }: { explanation: RecommendationExplanation }) {
  const fromProvider = explanation.agentStatus.mode === 'live_provider';
  const sections: Array<[string, string[]]> = [
    ['Recommended actions', explanation.recommendedActions],
    ['Starting XI', explanation.startingXiReasoning],
    ['Captaincy', explanation.captaincyReasoning],
    ['Transfers', explanation.transferReasoning],
    ['Risks', explanation.risks],
    ['Alternatives', explanation.alternatives],
    ['Data notes', explanation.dataLimitations],
    ['Rule checks', explanation.constraintSummary]
  ];
  return (
    <section aria-labelledby="explanation-title">
      <div className="rule-heading">
        <h2 id="explanation-title" className="section-title">Recommendation explanation</h2>
      </div>
      <p className="mt-4 max-w-3xl text-base leading-relaxed">{explanation.summary}</p>
      <div className="mt-6 grid gap-x-12 gap-y-7 md:grid-cols-2">
        {sections.filter(([, items]) => items.length > 0).map(([title, items]) => (
          <div key={title}>
            <h3 className="eyebrow border-b border-line pb-2">{title}</h3>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink-soft">
              {items.map((item, index) => <li key={index} className="border-l-2 border-line pl-3">{item}</li>)}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-7 border-t border-line pt-4 text-[13px] leading-relaxed text-ink-faint">
        {fromProvider
          ? 'This text was written by a language model from the plan above. It was checked so that it only names players in the plan.'
          : 'This text was assembled from the plan above by fixed rules, with no language model involved.'}
        {' '}The lineup, captain and transfers were chosen by the optimizer before any text was written. {explanation.disclaimer}
      </p>
    </section>
  );
}

const humanizeKey = (value: string): string => {
  const text = value.split('_').join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const formatConstraintValue = (value: number | string | Record<string, number>): string => {
  if (typeof value === 'number' || typeof value === 'string') return String(value);
  return Object.entries(value).map(([key, entryValue]) => `${key}: ${entryValue}`).join(', ');
};
