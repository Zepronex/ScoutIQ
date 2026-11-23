import axios from 'axios';
import {
  ApiResponse,
  EnrichedPlayer,
  Squad,
  SquadAnalysis,
  PlayersResponse,
  PlayerSearchResult,
  CountedApiResponse,
  AgentPublicStatus,
  EvaluationDataHealth,
  EvaluationLatest,
  EvaluationRuns,
  PlanningData,
  PredictionSummary,
  OptimizerResult,
  ExplainRecommendationRequest,
  RecommendationExplanation,
  SquadOptimizationRequest,
  StartingXIOptimizerResult,
  StartingXIRecommendationRequest,
  TransferOptimizerResult,
  TransferRecommendationRequest
} from './types';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const apiClient = {
  // Players API
  async getPlayers(signal?: AbortSignal): Promise<PlayersResponse> {
    const response = await api.get('/players', { signal });
    return response.data;
  },

  async importEntry(entryId: number, signal?: AbortSignal): Promise<ApiResponse<{ squad: Squad; gameweekId: number; season: string | null }>> {
    const response = await api.post('/entries/import', { entryId }, { signal });
    return response.data;
  },

  async searchPlayer(name: string, signal?: AbortSignal): Promise<PlayersResponse> {
    try {
      const response = await api.get('/players/search', { params: { name }, signal });
      return response.data;
    } catch (error) {
      const errorResponse = signal?.aborted ? null : toPlayersResponse(error);
      if (errorResponse) return errorResponse;
      throw error;
    }
  },

  async getPlayerById(id: number, signal?: AbortSignal): Promise<PlayerSearchResult> {
    const response = await api.get(`/players/${id}`, { signal });
    return response.data;
  },

  async getPlayersByPosition(position: string): Promise<PlayersResponse> {
    const response = await api.get(`/players/position/${position}`);
    return response.data;
  },

  // Analysis API
  async analyzeSquad(squad: Squad, signal?: AbortSignal): Promise<ApiResponse<SquadAnalysis>> {
    try {
      const response = await api.post('/analyze', { squad, verifySavedNames: true }, { signal });
      return response.data;
    } catch (error) {
      return toApiResponse<SquadAnalysis>(
        error,
        'Could not analyze the squad. Try again shortly.'
      );
    }
  },

  async validateSquad(squad: Squad): Promise<ApiResponse<{ valid: boolean; errors: string[] }>> {
    const response = await api.post('/analyze/validate', { squad });
    return response.data;
  },

  // Optimizer API
  async getStartingXIRecommendation(
    request: StartingXIRecommendationRequest, signal?: AbortSignal
  ): Promise<ApiResponse<StartingXIOptimizerResult>> {
    const response = await api.post('/optimizer/starting-xi', request, { signal });
    return response.data;
  },

  async getTransferRecommendations(
    request: TransferRecommendationRequest, signal?: AbortSignal
  ): Promise<CountedApiResponse<TransferOptimizerResult>> {
    const response = await api.post('/optimizer/transfers', request, { signal });
    return response.data;
  },

  async getSquadRecommendation(
    request: SquadOptimizationRequest, signal?: AbortSignal
  ): Promise<ApiResponse<OptimizerResult>> {
    const response = await api.post('/optimizer/squad', request, { signal });
    return response.data;
  },

  async explainRecommendation(
    request: ExplainRecommendationRequest, signal?: AbortSignal
  ): Promise<ApiResponse<RecommendationExplanation>> {
    const response = await api.post('/agent/explain-recommendation', request, { signal });
    return response.data;
  },

  async getAgentStatus(): Promise<ApiResponse<AgentPublicStatus>> {
    const response = await api.get('/agent/status');
    return response.data;
  },

  // Evaluation API
  async getEvaluationLatest(): Promise<ApiResponse<EvaluationLatest>> {
    const response = await api.get('/evaluation/latest');
    return response.data;
  },

  async getEvaluationRuns(limit: number = 5): Promise<CountedApiResponse<EvaluationRuns>> {
    const response = await api.get(`/evaluation/runs?limit=${encodeURIComponent(String(limit))}`);
    return response.data;
  },

  async getEvaluationDataHealth(): Promise<ApiResponse<EvaluationDataHealth>> {
    const response = await api.get('/evaluation/data-health');
    return response.data;
  },

  async getTopPredictions(limit: number = 100): Promise<ApiResponse<PredictionSummary>> {
    try {
      const response = await api.get(`/predictions/top?limit=${encodeURIComponent(String(limit))}`);
      return response.data;
    } catch (error) {
      return toApiResponse<PredictionSummary>(
        error,
        'Could not load top players. Confirm that PostgreSQL is running and prediction data is loaded.'
      );
    }
  },

  async getPlanningData(signal?: AbortSignal): Promise<ApiResponse<PlanningData>> {
    const response = await api.get('/predictions/planning', { signal });
    return response.data;
  },

  // Health check
  async healthCheck() {
    const response = await api.get('/health');
    return response.data;
  }
};

function toPlayersResponse(error: unknown): PlayersResponse | null {
  if (!axios.isAxiosError(error)) return null;

  const payload = error.response?.data;
  if (error.response?.status !== 429 && isApiResponse<EnrichedPlayer[]>(payload)) return payload;

  return {
    success: false,
    data: [],
    count: 0,
    error: apiErrorMessage(error, 'Could not reach ScoutIQ. Try again shortly.')
  };
}

function toApiResponse<T>(error: unknown, fallbackError: string): ApiResponse<T> {
  if (axios.isAxiosError(error)) {
    const payload = error.response?.data;
    if (error.response?.status !== 429 && isApiResponse<T>(payload)) return payload;
  }

  return {
    success: false,
    error: apiErrorMessage(error, fallbackError)
  };
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  if (!axios.isAxiosError(error)) return fallback;
  if (error.response?.status === 429) {
    const seconds = Number(error.response.headers['retry-after']);
    return Number.isFinite(seconds) && seconds > 0
      ? `Request limit reached. Try again in about ${Math.ceil(seconds / 60)} min.`
      : 'Request limit reached. Try again shortly.';
  }
  return typeof error.response?.data?.error === 'string' ? error.response.data.error : fallback;
}

function isApiResponse<T>(value: unknown): value is ApiResponse<T> {
  if (typeof value !== 'object' || value === null) return false;

  const payload = value as Partial<ApiResponse<T>>;
  return typeof payload.success === 'boolean';
}

export default apiClient;
