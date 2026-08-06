/**
 * TICKET_650 Phase 4: Hook to fetch backend validation report for an algorithm
 */
import { useState, useEffect } from 'react';
import i18n from 'i18next';
import type { ValidationReport } from '../../shared/types/validation-report';

interface UseBackendValidationReportResult {
  report: ValidationReport | null;
  loading: boolean;
  error: string | null;
}

export function useBackendValidationReport(algorithmId?: number): UseBackendValidationReportResult {
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!algorithmId) {
      setReport(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    window.electronAPI?.executor?.getValidationReport(algorithmId)
      .then((result) => {
        if (cancelled) return;
        if (result.success) {
          setReport(result.data ?? null);
        } else {
          setError(result.error ?? i18n.t('renderer.validation.failedToFetchReport', { ns: 'errors' }));
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [algorithmId]);

  return { report, loading, error };
}
