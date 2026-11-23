import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient, apiErrorMessage } from '../lib/api';
import { PlanningData } from '../lib/types';

export function usePlanning() {
  const [state, setState] = useState<{ data: PlanningData | null; loading: boolean; error: string | null }>({
    data: null, loading: true, error: null
  });
  const request = useRef<AbortController>();
  const lastRequest = useRef(0);

  const reload = useCallback(() => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    lastRequest.current = Date.now();
    setState({ data: null, loading: true, error: null });
    void apiClient.getPlanningData(controller.signal).then(response => {
      if (controller.signal.aborted) return;
      if (!response.success || !response.data) throw new Error('No planning data returned');
      setState({ data: response.data, loading: false, error: null });
    }).catch(error => {
      if (controller.signal.aborted) return;
      setState({ data: null, loading: false, error: apiErrorMessage(error, 'Could not load the FPL schedule. Try again shortly.') });
    });
  }, []);

  useEffect(() => {
    reload();
    const refreshOnReturn = () => {
      if (!document.hidden && Date.now() - lastRequest.current > 60_000) reload();
    };
    document.addEventListener('visibilitychange', refreshOnReturn);
    return () => {
      request.current?.abort();
      document.removeEventListener('visibilitychange', refreshOnReturn);
    };
  }, [reload]);

  const deadline = state.data?.gameweek?.deadline;
  useEffect(() => {
    if (!deadline) return;
    const untilDeadline = Date.parse(deadline) - Date.now();
    if (untilDeadline <= 0 || untilDeadline > 2_147_000_000) return;
    const timer = window.setTimeout(reload, Math.max(1000, untilDeadline + 1000));
    return () => window.clearTimeout(timer);
  }, [deadline, reload]);

  return { ...state, reload };
}

export type PlanningState = ReturnType<typeof usePlanning>;
