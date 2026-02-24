import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Play, Download, Bot, Clock, AlertTriangle } from 'lucide-react';
import { useAutomationJobs } from '@/hooks/useStrategy';
import { format } from 'date-fns';

interface AutomationPanelProps {
  configId?: string;
  automationMode: string;
  schedule: string;
  onModeChange: (mode: string) => void;
  onScheduleChange: (schedule: string) => void;
  onRunNow: () => void;
  isRunning: boolean;
  logs: any[];
}

export function AutomationPanel({
  configId, automationMode, schedule,
  onModeChange, onScheduleChange, onRunNow, isRunning, logs,
}: AutomationPanelProps) {
  const { data: jobs } = useAutomationJobs(configId);

  const exportCsv = () => {
    if (!logs.length) return;
    const headers = ['Tidpunkt', 'Åtgärd', 'Ticker', 'Detaljer'];
    const rows = logs.map(l => [
      l.created_at, l.action, l.ticker || '', JSON.stringify(l.details || {}),
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'strategy-log.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Bot className="w-4 h-4" /> Automation
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1">Läge</Label>
              <Select value={automationMode} onValueChange={onModeChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="OFF">Av</SelectItem>
                  <SelectItem value="SIMULATE">Simulering (paper)</SelectItem>
                  <SelectItem value="LIVE" disabled>Live (kräver broker)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1">Schema</Label>
              <Select value={schedule} onValueChange={onScheduleChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daglig (09:00 UTC)</SelectItem>
                  <SelectItem value="weekly">Veckovis (mån 09:00 UTC)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {automationMode === 'LIVE' && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
              <AlertTriangle className="w-4 h-4 text-yellow-500 mt-0.5" />
              <p className="text-xs text-yellow-200/80">Live-trading kräver broker-integration som inte är tillgänglig ännu.</p>
            </div>
          )}

          <Button onClick={onRunNow} disabled={isRunning || !configId} className="w-full">
            <Play className={`w-4 h-4 mr-1 ${isRunning ? 'animate-spin' : ''}`} />
            {isRunning ? 'Kör utvärdering...' : 'Kör utvärdering nu'}
          </Button>
        </CardContent>
      </Card>

      {/* Jobs history */}
      {jobs && jobs.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4" /> Körningshistorik
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tid</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Universum</TableHead>
                  <TableHead>Kandidater</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.slice(0, 10).map((j) => (
                  <TableRow key={j.id}>
                    <TableCell className="text-xs">{format(new Date(j.started_at), 'yyyy-MM-dd HH:mm')}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={j.status === 'completed' ? 'text-emerald-400' : j.status === 'running' ? 'text-blue-400' : 'text-red-400'}>
                        {j.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{j.universe_size ?? '–'}</TableCell>
                    <TableCell className="font-mono text-xs">{j.candidates_found ?? '–'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Trade Log */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base">Handelslogg</CardTitle>
          {logs.length > 0 && (
            <Button variant="ghost" size="sm" onClick={exportCsv}>
              <Download className="w-3 h-3 mr-1" /> CSV
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Ingen logg ännu.</p>
          ) : (
            <div className="space-y-1 max-h-[300px] overflow-auto">
              {logs.slice(0, 50).map((l) => (
                <div key={l.id} className="flex items-center gap-2 text-xs p-2 rounded hover:bg-accent/30">
                  <span className="text-muted-foreground w-28 flex-shrink-0">
                    {format(new Date(l.created_at), 'MM-dd HH:mm')}
                  </span>
                  <Badge variant="outline" className="text-[10px]">{l.action}</Badge>
                  <span className="font-mono">{l.ticker || '–'}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
