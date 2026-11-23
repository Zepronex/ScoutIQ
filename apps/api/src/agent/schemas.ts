import { z } from 'zod';

// Everything accepted here is forwarded to a paid language model when the
// explanation provider is enabled. Each field is capped so one request cannot
// carry more than a real optimizer result would.
const MAX_ID = 2_147_483_647;
const PositionSchema = z.enum(['GK', 'DEF', 'MID', 'FWD']);
const AvailabilitySchema = z.enum(['available', 'doubtful', 'unavailable', 'unknown']);
const PositiveIdSchema = z.coerce.number().int().positive().max(MAX_ID);
const MoneySchema = z.coerce.number().nonnegative().max(1000);
const PointsSchema = z.coerce.number().nonnegative().max(1000);
const SignedPointsSchema = z.coerce.number().min(-1000).max(1000);
// Names are letters, marks, digits, spaces and name punctuation only.
const NameSchema = (max: number) => z.string().min(1).max(max).regex(/^[\p{L}\p{M}\p{N} .,'’&()\/-]+$/u);
const ConstraintKeySchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_.:-]+$/);
const ConstraintValueSchema = z.union([
  z.number(),
  z.string().max(256),
  z.record(ConstraintKeySchema, z.number()).refine(value => Object.keys(value).length <= 32)
]);
const OptimizerDisplayScoreSchema = z.object({
  rawExpectedPoints: z.number().min(0).max(1000).nullable(),
  contextualScoreOutOf10: z.number().min(0).max(10).nullable(),
  positionPercentile: z.number().min(0).max(100).nullable(),
  positionPoolSize: z.number().int().min(0).max(5000)
}).strict();

export const PlayerCandidateSchema = z.object({
  playerId: PositiveIdSchema,
  playerName: NameSchema(100),
  position: PositionSchema,
  teamId: PositiveIdSchema,
  teamName: NameSchema(100).optional(),
  teamShortName: NameSchema(10).optional(),
  price: MoneySchema,
  predictedPoints: PointsSchema,
  predictionRunId: PositiveIdSchema.optional(),
  targetGameweekId: PositiveIdSchema.optional(),
  fixtureId: PositiveIdSchema.nullable().optional(),
  fixtureCount: z.number().int().nonnegative().max(10).optional(),
  availability: AvailabilitySchema.optional(),
  displayScore: OptimizerDisplayScoreSchema.optional()
}).strict();

export const SquadSlotSchema = PlayerCandidateSchema.extend({
  slotIndex: z.coerce.number().int().min(0).max(14),
  sellingPrice: MoneySchema.optional()
}).strict();

export const SquadSchema = z.object({
  slots: z.array(SquadSlotSchema).length(15),
  budget: MoneySchema,
  bank: MoneySchema,
  existingSquad: z.boolean().optional()
}).strict();

export const ConstraintCheckSchema = z.object({
  key: ConstraintKeySchema,
  passed: z.boolean(),
  expected: ConstraintValueSchema,
  actual: ConstraintValueSchema
}).strict();

export const ConstraintViolationSchema = z.object({
  code: z.enum([
    'duplicate_player',
    'invalid_budget',
    'invalid_captaincy',
    'invalid_formation',
    'invalid_position_count',
    'invalid_squad_size',
    'invalid_starting_xi_size',
    'max_players_per_team',
    'transfer_count_exceeded',
    'unknown_player'
  ]),
  key: ConstraintKeySchema,
  expected: ConstraintValueSchema,
  actual: ConstraintValueSchema,
  playerIds: z.array(PositiveIdSchema).max(15).optional(),
  teamId: PositiveIdSchema.optional()
}).strict();

export const ConstraintValidationResultSchema = z.object({
  valid: z.boolean(),
  checks: z.array(ConstraintCheckSchema).max(40),
  violations: z.array(ConstraintViolationSchema).max(40)
}).strict();

export const CaptaincyRecommendationSchema = z.object({
  captain: SquadSlotSchema,
  viceCaptain: SquadSlotSchema,
  captainPredictedPoints: PointsSchema,
  viceCaptainPredictedPoints: PointsSchema
}).strict();

export const StartingXISchema = z.object({
  formation: z.enum(['3-4-3', '3-5-2', '4-4-2', '4-3-3', '4-5-1', '5-2-3', '5-3-2', '5-4-1']),
  starters: z.array(SquadSlotSchema).length(11),
  bench: z.array(SquadSlotSchema).length(4),
  captaincy: CaptaincyRecommendationSchema,
  totalPredictedPoints: PointsSchema,
  rawExpectedPoints: PointsSchema.optional(),
  averagePlayerScoreOutOf10: PointsSchema.nullable().optional(),
  normalizedTeamScoreOutOf100: PointsSchema.nullable().optional(),
  constraintSummary: ConstraintValidationResultSchema
}).strict();

export const TransferMoveSchema = z.object({
  playerOut: SquadSlotSchema,
  playerIn: PlayerCandidateSchema,
  predictedPointsDelta: SignedPointsSchema,
  costDelta: SignedPointsSchema
}).strict();

export const TransferRecommendationSchema = z.object({
  transferCount: z.union([z.literal(1), z.literal(2)]),
  moves: z.array(TransferMoveSchema).min(1).max(2),
  expectedPointsGain: SignedPointsSchema,
  pointsHit: z.coerce.number().int().min(0).max(100),
  netExpectedPointsGain: SignedPointsSchema,
  budgetImpact: SignedPointsSchema,
  bankAfterTransfers: MoneySchema,
  squadAfterTransfers: SquadSchema,
  startingXi: StartingXISchema,
  validation: ConstraintValidationResultSchema
}).strict();

export const RecommendationExplanationInputSchema = z.object({
  startingXi: StartingXISchema,
  transferRecommendations: z.array(TransferRecommendationSchema).max(4).default([]),
  predictionRunIds: z.array(PositiveIdSchema).max(10).default([]),
  targetGameweekId: PositiveIdSchema.optional()
}).strict();

export const ExplainRecommendationRequestSchema = z.object({
  optimizerResult: RecommendationExplanationInputSchema
}).strict();

const ExplanationTextArraySchema = z.array(z.string().trim().min(1).max(2000)).max(12);

export const RecommendationExplanationCoreSchema = z.object({
  summary: z.string().trim().min(1).max(2000),
  recommendedActions: ExplanationTextArraySchema,
  startingXiReasoning: ExplanationTextArraySchema,
  captaincyReasoning: ExplanationTextArraySchema,
  transferReasoning: ExplanationTextArraySchema,
  risks: ExplanationTextArraySchema,
  alternatives: ExplanationTextArraySchema,
  dataLimitations: ExplanationTextArraySchema,
  constraintSummary: ExplanationTextArraySchema,
  disclaimer: z.string().trim().min(1).max(2000)
}).strict();

export const AgentExplanationModeSchema = z.enum(['deterministic_fallback', 'live_provider']);
export const AgentFallbackReasonCodeSchema = z.enum([
  'agent_disabled',
  'missing_openai_config',
  'missing_azure_openai_config',
  'missing_provider_config',
  'provider_error',
  'schema_validation_failed',
  'hallucination_guard_failed',
  'daily_limit_reached'
]);

export const AgentExplanationStatusSchema = z.object({
  mode: AgentExplanationModeSchema,
  provider: z.enum(['deterministic_fallback', 'openai', 'azure_openai']),
  providerConfigured: z.boolean(),
  fallbackReasonCode: AgentFallbackReasonCodeSchema.optional(),
  message: z.string().trim().min(1)
}).strict();

export const RecommendationExplanationSchema = RecommendationExplanationCoreSchema.extend({
  provider: z.enum(['deterministic_fallback', 'openai', 'azure_openai']),
  usedFallback: z.boolean(),
  fallbackReason: z.string().trim().min(1).optional(),
  agentStatus: AgentExplanationStatusSchema
}).strict();

export const RecommendationExplanationJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    recommendedActions: { type: 'array', items: { type: 'string' } },
    startingXiReasoning: { type: 'array', items: { type: 'string' } },
    captaincyReasoning: { type: 'array', items: { type: 'string' } },
    transferReasoning: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    alternatives: { type: 'array', items: { type: 'string' } },
    dataLimitations: { type: 'array', items: { type: 'string' } },
    constraintSummary: { type: 'array', items: { type: 'string' } },
    disclaimer: { type: 'string' }
  },
  required: [
    'summary',
    'recommendedActions',
    'startingXiReasoning',
    'captaincyReasoning',
    'transferReasoning',
    'risks',
    'alternatives',
    'dataLimitations',
    'constraintSummary',
    'disclaimer'
  ]
} as const;

export type RecommendationExplanationInput = z.infer<typeof RecommendationExplanationInputSchema>;
export type ExplainRecommendationRequest = z.infer<typeof ExplainRecommendationRequestSchema>;
export type RecommendationExplanationCore = z.infer<typeof RecommendationExplanationCoreSchema>;
export type AgentFallbackReasonCode = z.infer<typeof AgentFallbackReasonCodeSchema>;
export type RecommendationExplanation = z.infer<typeof RecommendationExplanationSchema>;
