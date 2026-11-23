import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Coins,
  FileText,
  RefreshCw,
  ShieldCheck,
  Trophy,
  Users
} from 'lucide-react';
import {
  ConstraintValidationResult,
  OptimizerSquadSlot,
  RecommendationExplanation,
  StartingXIRecommendation,
  TransferRecommendation
} from '../lib/types';
import { formatPoints, formatPrice, getPositionColor, predictionAvailability } from '../lib/format';
import LoadingSpinner from './LoadingSpinner';
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
};

const OptimizerRecommendations = ({
  startingXi,
  transferRecommendations,
  transferControls,
  isLoading,
  error,
  emptyMessage,
  onRetry,
  targetGameweekId,
  predictionRunIds
}: OptimizerRecommendationsProps) => {
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

  if (isLoading) return <section className="card"><LoadingSpinner text="Calculating the lineup…" /></section>;
  if (error) return <StatusPanel tone="error" title="Lineup unavailable" message={error}
    action={onRetry ? { label: 'Retry lineup', onClick: onRetry } : undefined} />;
  if (!startingXi) return <StatusPanel tone="info" title="No lineup projection" message={emptyMessage} />;

  return (
    <section className="space-y-5">
      <StartingXiSection recommendation={startingXi} />
      {transferControls}
      {transferRecommendations && (
        transferRecommendations.length > 0 ? <TransfersSection recommendations={transferRecommendations}
          beforePoints={startingXi.totalPredictedPoints} /> : <StatusPanel tone="info" title="Keep your squad this gameweek"
          message="No transfer within your settings improves the projected lineup after points hits." />
      )}
      {explaining || explanation || explanationError
        ? <ExplanationPanel explanation={explanation} isLoading={explaining} error={explanationError} onRetry={explain} />
        : <button className="btn-secondary" type="button" onClick={explain}>Explain this plan</button>}
    </section>
  );
};

type StatusTone = 'error' | 'warning' | 'info';

type StatusPanelProps = {
  tone: StatusTone;
  title: string;
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
};

const StatusPanel = ({ tone, title, message, action }: StatusPanelProps) => {
  const toneClass = {
    error: 'border-red-200 bg-red-50 text-red-800',
    warning: 'border-yellow-200 bg-yellow-50 text-yellow-800',
    info: 'border-blue-200 bg-blue-50 text-blue-800'
  }[tone];

  return (
    <section className={`rounded-lg border p-5 ${toneClass}`}>
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />
        <div>
          <h3 className="font-semibold">{title}</h3>
          <p className="mt-1 text-sm">{message}</p>
          {action && (
            <button
              onClick={action.onClick}
              className="mt-3 inline-flex items-center rounded-md border border-current bg-white px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
            >
              <RefreshCw className="mr-1 h-4 w-4" />
              {action.label}
            </button>
          )}
        </div>
      </div>
    </section>
  );
};

type ExplanationPanelProps = {
  explanation: RecommendationExplanation | null;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
};

const ExplanationPanel = ({ explanation, isLoading, error, onRetry }: ExplanationPanelProps) => {
  if (isLoading) {
    return (
      <section className="rounded-lg border border-gray-200 bg-white p-6">
        <LoadingSpinner text="Preparing recommendation explanation..." />
        <p className="mt-3 text-center text-sm text-gray-600">
          The optimizer result has already been produced; this step only prepares explanatory text.
        </p>
      </section>
    );
  }

  if (error) {
    return (
      <StatusPanel
        tone="warning"
        title="Explanation unavailable"
        message={error}
        action={{ label: 'Retry explanation', onClick: onRetry }}
      />
    );
  }

  if (!explanation) {
    return (
      <StatusPanel
        tone="info"
        title="Explanation pending"
        message="An explanation will appear after the optimizer returns a recommendation payload."
        action={{ label: 'Retry explanation', onClick: onRetry }}
      />
    );
  }

  const modeLabel = formatAgentModeLabel(explanation);
  const fallbackMessage = explanation.fallbackReason ?? explanation.agentStatus.message;

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-gray-100 p-2 text-gray-700">
            <FileText className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-xl font-semibold text-fpl-dark">Recommendation explanation</h3>
            <p className="mt-1 text-sm text-gray-600">{explanation.summary}</p>
          </div>
        </div>
        <div className="w-fit rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
          <div className="text-xs font-semibold uppercase text-gray-500">Explanation mode</div>
          <div className="font-medium text-gray-900">{modeLabel}</div>
          <div className="mt-1 max-w-xs text-xs text-gray-600">{explanation.agentStatus.message}</div>
        </div>
      </div>

      {explanation.agentStatus.mode === 'deterministic_fallback' && (
        <div className="mb-5 rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-900">
          <p>{fallbackMessage}</p>
          <p className="mt-2">
            Recommendations remain valid because the optimizer selected the players, transfers, captaincy and bench order before this explanation was generated.
          </p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <ExplanationSection title="Recommended actions" items={explanation.recommendedActions} />
        <ExplanationSection title="Starting XI reasoning" items={explanation.startingXiReasoning} />
        <ExplanationSection title="Captaincy reasoning" items={explanation.captaincyReasoning} />
        <ExplanationSection title="Transfer reasoning" items={explanation.transferReasoning} />
        <ExplanationSection title="Risks" items={explanation.risks} />
        <ExplanationSection title="Alternatives" items={explanation.alternatives} />
        <ExplanationSection title="Data notes" items={explanation.dataLimitations} />
        <ExplanationSection title="Rule-check details" items={explanation.constraintSummary} />
      </div>

      <div className="mt-5 rounded-md border border-gray-200 bg-gray-50 p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-700" />
          <div>
            <h4 className="text-sm font-semibold text-gray-900">Why this is safe</h4>
            <p className="mt-1 text-sm text-gray-600">
              The optimizer decides the recommendation. The agent only explains the supplied optimizer output, and live provider responses must pass schema validation and grounding checks before display. If those checks fail, deterministic fallback is used.
            </p>
          </div>
        </div>
      </div>

      <p className="mt-5 border-t border-gray-200 pt-4 text-sm text-gray-600">
        {explanation.disclaimer}
      </p>
    </section>
  );
};

const formatAgentModeLabel = (explanation: RecommendationExplanation): string => {
  if (explanation.agentStatus.mode === 'deterministic_fallback') {
    return 'Deterministic fallback';
  }

  return `${formatProviderName(explanation.agentStatus.provider)} provider`;
};

const formatProviderName = (provider: RecommendationExplanation['agentStatus']['provider']): string => {
  switch (provider) {
    case 'openai':
      return 'OpenAI';
    case 'azure_openai':
      return 'Azure OpenAI';
    case 'deterministic_fallback':
      return 'Deterministic fallback';
  }
};

type ExplanationSectionProps = {
  title: string;
  items: string[];
};

const ExplanationSection = ({ title, items }: ExplanationSectionProps) => {
  if (items.length === 0) return null;

  return (
    <div className="rounded-md border border-gray-100 bg-gray-50 p-4">
      <h4 className="text-sm font-semibold text-gray-900">{title}</h4>
      <ul className="mt-3 space-y-2 text-sm text-gray-700">
        {items.map((item, index) => (
          <li key={`${title}-${index}`} className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-400" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

type StartingXiSectionProps = {
  recommendation: StartingXIRecommendation;
};

const StartingXiSection = ({ recommendation }: StartingXiSectionProps) => {
  const unavailablePlayers = [...recommendation.starters, ...recommendation.bench]
    .filter(player => player.availability === 'doubtful' || player.availability === 'unavailable');

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <MetricTile
          icon={<Users className="h-5 w-5" />}
          label="Formation"
          value={recommendation.formation}
        />
        <MetricTile
          icon={<Trophy className="h-5 w-5" />}
          label="Projected points (captain ×2)"
          value={formatPoints(recommendation.totalPredictedPoints)}
        />
        <MetricTile
          icon={<ShieldCheck className="h-5 w-5" />}
          label="Rule checks"
          value={recommendation.constraintSummary.valid ? 'Valid' : 'Invalid'}
          tone={recommendation.constraintSummary.valid ? 'success' : 'warning'}
        />
      </div>

      <CaptaincyPanel recommendation={recommendation} />

      {unavailablePlayers.length > 0 && (
        <StatusPanel
          tone="warning"
          title="Availability warning"
          message={`${unavailablePlayers.length} recommended player(s) are marked doubtful or unavailable in the prediction data.`}
        />
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">Recommended starting XI</h3>
            <span className="text-sm text-gray-500">{recommendation.starters.length} players</span>
          </div>
          <div className="space-y-2">
            {recommendation.starters.map(player => (
              <PlayerProjectionRow
                key={player.playerId}
                player={player}
              />
            ))}
          </div>
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">Bench order</h3>
            <span className="text-sm text-gray-500">{recommendation.bench.length} players</span>
          </div>
          <div className="space-y-2">
            {recommendation.bench.map((player, index) => (
              <PlayerProjectionRow
                key={player.playerId}
                player={player}
                prefix={player.position === 'GK' ? 'GK' : String(index + 1)}
              />
            ))}
          </div>
        </div>
      </div>

      <ConstraintSummary validation={recommendation.constraintSummary} />
    </div>
  );
};

type MetricTileProps = {
  icon: ReactNode;
  label: string;
  value: string;
  tone?: 'default' | 'success' | 'warning';
};

const MetricTile = ({ icon, label, value, tone = 'default' }: MetricTileProps) => {
  const toneClass = {
    default: 'bg-gray-50 text-fpl-dark',
    success: 'bg-green-50 text-green-700',
    warning: 'bg-yellow-50 text-yellow-700'
  }[tone];

  return (
    <div className={`rounded-lg border border-gray-200 p-4 ${toneClass}`}>
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
};

type CaptaincyPanelProps = {
  recommendation: StartingXIRecommendation;
};

const CaptaincyPanel = ({ recommendation }: CaptaincyPanelProps) => {
  const { captaincy } = recommendation;

  return (
    <div className="mb-5 grid gap-3 sm:grid-cols-2">
      <CaptaincyPlayer
        label="Captain"
        badge="C"
        player={captaincy.captain}
        points={captaincy.captainPredictedPoints}
      />
      <CaptaincyPlayer
        label="Vice captain"
        badge="VC"
        player={captaincy.viceCaptain}
        points={captaincy.viceCaptainPredictedPoints}
      />
    </div>
  );
};

type CaptaincyPlayerProps = {
  label: string;
  badge: string;
  player: OptimizerSquadSlot;
  points: number;
};

const CaptaincyPlayer = ({ label, badge, player, points }: CaptaincyPlayerProps) => (
  <div className="rounded-lg border border-green-200 bg-green-50 p-4">
    <div className="mb-2 flex items-center justify-between">
      <span className="text-sm font-medium text-green-800">{label}</span>
      <span className="rounded-full bg-green-700 px-2 py-1 text-xs font-bold text-white">{badge}</span>
    </div>
    <div className="font-semibold text-gray-900">{player.playerName}</div>
    <div className="mt-1 text-sm text-gray-600">
      {player.position} - {formatPoints(points)} projected points
    </div>
  </div>
);

type PlayerProjectionRowProps = {
  player: OptimizerSquadSlot;
  prefix?: string;
};

const PlayerProjectionRow = ({ player, prefix }: PlayerProjectionRowProps) => (
  <div className="flex items-center gap-3 rounded-md border border-gray-100 bg-gray-50 px-3 py-2">
    {prefix && (
      <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold text-gray-600">
        {prefix}
      </span>
    )}
    <span className={`rounded px-2 py-1 text-xs font-semibold ${getPositionColor(player.position)}`}>
      {player.position}
    </span>
    <div className="min-w-0 flex-1">
      <div className="break-words font-medium text-gray-900">{player.playerName}</div>
      <div className="text-xs text-gray-600">
        {player.teamShortName || player.teamName || 'Team unknown'} · {formatPrice(player.price)} · {predictionAvailability(player)}
      </div>
    </div>
    <div className="text-right">
      <div className="font-semibold text-fpl-dark">{formatPoints(player.predictedPoints)}</div>
      <div className="text-xs text-gray-500">pts</div>
    </div>
  </div>
);

type ConstraintSummaryProps = {
  validation: ConstraintValidationResult;
};

const ConstraintSummary = ({ validation }: ConstraintSummaryProps) => (
  <div className="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-4">
    <div className="flex items-center gap-2">
      {validation.valid ? (
        <CheckCircle2 className="h-5 w-5 text-green-600" />
      ) : (
        <AlertTriangle className="h-5 w-5 text-yellow-600" />
      )}
      <h3 className="font-semibold text-gray-900">Rule validation</h3>
    </div>
    <p className="mt-1 text-sm text-gray-600">
      {validation.valid
        ? `All ${validation.checks.length} optimizer checks passed.`
        : `${validation.violations.length} rule issue(s) need attention.`}
    </p>
    {!validation.valid && (
      <ul className="mt-3 space-y-2 text-sm text-gray-700">
        {validation.violations.slice(0, 3).map(violation => (
          <li key={`${violation.code}-${violation.key}`} className="rounded border border-yellow-200 bg-white p-2">
            <span className="font-medium">{humanizeKey(violation.key)}:</span>{' '}
            expected {formatConstraintValue(violation.expected)}, got {formatConstraintValue(violation.actual)}
          </li>
        ))}
      </ul>
    )}
  </div>
);

type TransfersSectionProps = {
  recommendations: TransferRecommendation[];
  beforePoints: number;
};

const TransfersSection = ({ recommendations, beforePoints }: TransfersSectionProps) => (
  <div className="rounded-lg border border-gray-200 bg-white p-5">
    <div className="mb-4 flex items-center justify-between">
      <div>
        <h3 className="text-xl font-semibold text-fpl-dark">Recommended transfer options</h3>
        <p className="text-sm text-gray-600">Ranked by net projected points gain.</p>
      </div>
      <Coins className="h-6 w-6 text-fpl-green" />
    </div>

    <div className="space-y-4">
      {[...recommendations].sort((a, b) => b.netExpectedPointsGain - a.netExpectedPointsGain || a.transferCount - b.transferCount).map(recommendation => (
        <TransferOption
          key={recommendation.moves.map(move => `${move.playerOut.playerId}-${move.playerIn.playerId}`).join('|')}
          recommendation={recommendation}
          beforePoints={beforePoints}
        />
      ))}
    </div>
  </div>
);

type TransferOptionProps = {
  recommendation: TransferRecommendation;
  beforePoints: number;
};

const TransferOption = ({ recommendation, beforePoints }: TransferOptionProps) => (
  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
    <div className="mb-4 grid gap-3 sm:grid-cols-4">
      <TransferMetric label="Transfers" value={`${recommendation.transferCount}`} />
      <TransferMetric label="Expected gain" value={signedPoints(recommendation.expectedPointsGain)} />
      <TransferMetric label="Net gain" value={signedPoints(recommendation.netExpectedPointsGain)} />
      <TransferMetric label="Bank after" value={formatPrice(recommendation.bankAfterTransfers)} />
    </div>

    <div className="space-y-3">
      {recommendation.moves.map(move => (
        <div
          key={`${move.playerOut.playerId}-${move.playerIn.playerId}`}
          className="grid gap-3 rounded-md bg-white p-3 sm:grid-cols-[1fr_auto_1fr]"
        >
          <TransferPlayer label="Sell" name={move.playerOut.playerName} points={move.playerOut.predictedPoints} price={move.playerOut.sellingPrice ?? move.playerOut.price} />
          <div className="flex items-center justify-center text-gray-400">
            <ArrowRight className="h-5 w-5" />
          </div>
          <TransferPlayer label="Buy" name={move.playerIn.playerName} points={move.playerIn.predictedPoints} price={move.playerIn.price} />
        </div>
      ))}
    </div>

    <div className="mt-4 grid gap-2 text-sm text-gray-600 sm:grid-cols-3">
      <span>Points hit: {recommendation.pointsHit}</span>
      <span>Budget impact: {formatMoneyDelta(recommendation.budgetImpact)}</span>
      <span>Projected XI {formatPoints(beforePoints)} → {formatPoints(recommendation.startingXi.totalPredictedPoints)} pts</span>
    </div>

    <ConstraintSummary validation={recommendation.validation} />
  </div>
);

type TransferMetricProps = {
  label: string;
  value: string;
};

const TransferMetric = ({ label, value }: TransferMetricProps) => (
  <div className="rounded-md bg-white p-3 text-center">
    <div className="text-lg font-bold text-fpl-dark">{value}</div>
    <div className="text-xs text-gray-500">{label}</div>
  </div>
);

type TransferPlayerProps = {
  label: string;
  name: string;
  points: number;
  price: number;
};

const TransferPlayer = ({ label, name, points, price }: TransferPlayerProps) => (
  <div>
    <div className="text-xs font-semibold uppercase text-gray-500">{label}</div>
    <div className="font-medium text-gray-900">{name}</div>
    <div className="text-sm text-gray-600">
      {formatPoints(points)} pts - {formatPrice(price)}
    </div>
  </div>
);

const signedPoints = (value: number) => `${value > 0 ? '+' : ''}${formatPoints(value)}`;

const formatMoneyDelta = (value: number): string => {
  if (value === 0) return formatPrice(0);
  return `${value > 0 ? '+' : '-'}${formatPrice(Math.abs(value))}`;
};

const humanizeKey = (value: string): string => {
  return value
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

const formatConstraintValue = (value: number | string | Record<string, number>): string => {
  if (typeof value === 'number' || typeof value === 'string') {
    return String(value);
  }

  return Object.entries(value)
    .map(([key, entryValue]) => `${key}: ${entryValue}`)
    .join(', ');
};

export default OptimizerRecommendations;
