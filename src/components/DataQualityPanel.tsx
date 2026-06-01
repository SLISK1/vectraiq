import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { ShieldCheck, ShieldAlert, AlertTriangle, Info } from 'lucide-react';
import {
  useDataQuality,
  type DataQualityIssue,
  type IssueSeverity,
} from '@/hooks/useDataQuality';

// Swedish labels for the issue types emitted by validate-data.
const ISSUE_LABELS: Record<string, string> = {
  future_date: 'Datum i framtiden',
  nonpositive_price: 'Ogiltigt pris (≤ 0)',
  implausible_jump: 'Osannolikt prishopp',
  stale_symbol: 'Inaktuell data',
  no_data: 'Saknar data',
};

const SEVERITY_LABELS: Record<IssueSeverity, string> = {
  critical: 'kritisk',
  warning: 'varning',
  info: 'info',
};

// Badge color per severity, reusing the app's up/down/muted tokens.
const severityBadgeClass = (sev: IssueSeverity): string => {
  if (sev === 'critical') return 'bg-down/15 text-down border-down/30';
  if (sev === 'warning') return 'bg-yellow-500/15 text-yellow-500 border-yellow-500/30';
  return 'bg-muted text-muted-foreground border-border';
};

// A short, human-readable summary of the issue's detail JSON.
const summarizeDetail = (issue: DataQualityIssue): string => {
  const d = issue.detail || {};
  switch (issue.issue_type) {
    case 'future_date':
      return `rad daterad ${d.date ?? '?'}`;
    case 'nonpositive_price':
      return `${d.date ?? '?'}: pris ${d.close_price ?? 'null'}`;
    case 'implausible_jump': {
      const ret = typeof d.return === 'number' ? `${(d.return * 100).toFixed(1)}%` : '?';
      return `${d.date ?? '?'}: ${ret} sedan ${d.prev_date ?? '?'}`;
    }
    case 'stale_symbol':
      return `senaste ${d.latest_date ?? '?'} (${d.age_days ?? '?'} dgr gammal)`;
    case 'no_data':
      return 'inga prisrader i fönstret';
    default:
      return '';
  }
};

const IssueRow = ({ issue }: { issue: DataQualityIssue }) => {
  const Icon = issue.severity === 'critical'
    ? ShieldAlert
    : issue.severity === 'warning'
    ? AlertTriangle
    : Info;
  const iconClass = issue.severity === 'critical'
    ? 'text-down'
    : issue.severity === 'warning'
    ? 'text-yellow-500'
    : 'text-muted-foreground';

  return (
    <div className="flex items-start gap-2 text-xs px-3 py-2 rounded-lg border border-border bg-muted/20">
      <Icon className={cn('w-3.5 h-3.5 mt-0.5 flex-shrink-0', iconClass)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono font-semibold">{issue.ticker || '—'}</span>
          <span className="text-muted-foreground">
            {ISSUE_LABELS[issue.issue_type] || issue.issue_type}
          </span>
          <Badge className={cn('px-1.5 py-0 text-[10px]', severityBadgeClass(issue.severity))}>
            {SEVERITY_LABELS[issue.severity]}
          </Badge>
        </div>
        <div className="text-muted-foreground truncate mt-0.5">{summarizeDetail(issue)}</div>
      </div>
      <span className="text-muted-foreground font-mono flex-shrink-0">
        {format(new Date(issue.detected_at), 'dd/MM HH:mm')}
      </span>
    </div>
  );
};

export const DataQualityPanel = () => {
  const { data, isLoading } = useDataQuality();

  const critical = data?.critical ?? 0;
  const warning = data?.warning ?? 0;
  const info = data?.info ?? 0;
  const issues = data?.issues ?? [];

  return (
    <div className="p-3 rounded-lg bg-muted/30 border border-border space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-primary" />
          Datakvalitet
        </h4>
        <div className="flex items-center gap-2 text-xs">
          {critical > 0 && <span className="text-down font-semibold">{critical} kritiska</span>}
          {warning > 0 && <span className="text-yellow-500 font-semibold">{warning} varningar</span>}
          {info > 0 && <span className="text-muted-foreground">{info} info</span>}
        </div>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground py-2">Laddar...</div>
      ) : issues.length === 0 ? (
        <div className="p-4 rounded-lg bg-up/10 text-sm text-up text-center flex flex-col items-center gap-2">
          <ShieldCheck className="w-5 h-5" />
          <span>Inga dataproblem upptäckta</span>
        </div>
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {issues.map((issue) => (
            <IssueRow key={issue.id} issue={issue} />
          ))}
        </div>
      )}
    </div>
  );
};
