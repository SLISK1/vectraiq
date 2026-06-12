import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export type IssueSeverity = 'info' | 'warning' | 'critical';

// One unresolved data-quality issue from validate-data. The data_quality_issues
// table is new, so the generated Supabase types may lag — see (supabase as any).
export interface DataQualityIssue {
  id: string;
  symbol_id: string | null;
  ticker: string | null;
  issue_type: string;
  severity: IssueSeverity;
  detail: Record<string, unknown> | null;
  detected_at: string;
  resolved: boolean;
}

export interface DataQualitySummary {
  issues: DataQualityIssue[];
  total: number;        // antal hämtade rader (cappad till MAX_ISSUES)
  total_open: number;   // verkligt antal öppna issues i databasen
  critical: number;
  warning: number;
  info: number;
}

const MAX_ISSUES = 100;

// Unresolved issues, newest first, with per-severity counts for the badges.
export function useDataQuality() {
  const { user } = useAuth();

  return useQuery<DataQualitySummary>({
    queryKey: ['data-quality-issues'],
    queryFn: async () => {
      // Hämta både listan (cappad) och en exakt totalsumma med head-count.
      const [{ data, error }, { count, error: countError }] = await Promise.all([
        (supabase as any)
          .from('data_quality_issues')
          .select('id, symbol_id, ticker, issue_type, severity, detail, detected_at, resolved')
          .eq('resolved', false)
          .order('detected_at', { ascending: false })
          .limit(MAX_ISSUES),
        (supabase as any)
          .from('data_quality_issues')
          .select('id', { count: 'exact', head: true })
          .eq('resolved', false),
      ]);

      if (error) throw error;
      if (countError) throw countError;

      const issues = (data || []) as DataQualityIssue[];
      return {
        issues,
        total: issues.length,
        total_open: count ?? issues.length,
        critical: issues.filter(i => i.severity === 'critical').length,
        warning: issues.filter(i => i.severity === 'warning').length,
        info: issues.filter(i => i.severity === 'info').length,
      };
    },
    enabled: !!user,
    refetchInterval: 60_000,
  });
}
