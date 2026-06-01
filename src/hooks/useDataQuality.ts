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
  total: number;
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
      // Cast to any: data_quality_issues is a new table the generated types may lag.
      const { data, error } = await (supabase as any)
        .from('data_quality_issues')
        .select('id, symbol_id, ticker, issue_type, severity, detail, detected_at, resolved')
        .eq('resolved', false)
        .order('detected_at', { ascending: false })
        .limit(MAX_ISSUES);

      if (error) throw error;

      const issues = (data || []) as DataQualityIssue[];
      return {
        issues,
        total: issues.length,
        critical: issues.filter(i => i.severity === 'critical').length,
        warning: issues.filter(i => i.severity === 'warning').length,
        info: issues.filter(i => i.severity === 'info').length,
      };
    },
    enabled: !!user,
    refetchInterval: 60_000,
  });
}
