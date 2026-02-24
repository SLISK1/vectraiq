import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RefreshCw, Globe, Star, LayoutGrid, Edit3, AlertTriangle, Info } from 'lucide-react';
import { useSP500Universe } from '@/hooks/useStrategy';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface UniverseBuilderProps {
  sources: string[];
  onSourcesChange: (s: string[]) => void;
  combineMode: string;
  onCombineModeChange: (m: string) => void;
  candidateLimit: number;
  onCandidateLimitChange: (n: number) => void;
  manualTickers: string;
  onManualTickersChange: (t: string) => void;
}

export function UniverseBuilder({
  sources, onSourcesChange, combineMode, onCombineModeChange,
  candidateLimit, onCandidateLimitChange, manualTickers, onManualTickersChange,
}: UniverseBuilderProps) {
  const sp500 = useSP500Universe();
  const [showManual, setShowManual] = useState(sources.includes('manual'));

  const toggleSource = (src: string) => {
    if (sources.includes(src)) {
      onSourcesChange(sources.filter(s => s !== src));
      if (src === 'manual') setShowManual(false);
    } else {
      onSourcesChange([...sources, src]);
      if (src === 'manual') setShowManual(true);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
        <AlertTriangle className="w-4 h-4 text-yellow-500 mt-0.5 flex-shrink-0" />
        <p className="text-xs text-yellow-200/80">
          Historisk data garanterar inte framtida resultat. Denna funktion syftar till att hjälpa dig simulera och testa strategier.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="w-4 h-4" /> Datakällor
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {/* Watchlist */}
            <label className="flex items-center gap-2 p-3 rounded-lg border cursor-pointer hover:bg-accent/50 transition-colors">
              <Checkbox checked={sources.includes('watchlist')} onCheckedChange={() => toggleSource('watchlist')} />
              <Star className="w-4 h-4 text-yellow-500" />
              <span className="text-sm font-medium">Watchlist</span>
            </label>

            {/* Screener */}
            <label className="flex items-center gap-2 p-3 rounded-lg border cursor-pointer hover:bg-accent/50 transition-colors">
              <Checkbox checked={sources.includes('screener')} onCheckedChange={() => toggleSource('screener')} />
              <LayoutGrid className="w-4 h-4 text-blue-400" />
              <span className="text-sm font-medium">Screener</span>
            </label>

            {/* S&P 500 */}
            <label className="flex items-center gap-2 p-3 rounded-lg border cursor-pointer hover:bg-accent/50 transition-colors">
              <Checkbox checked={sources.includes('sp500')} onCheckedChange={() => toggleSource('sp500')} />
              <Globe className="w-4 h-4 text-emerald-400" />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">S&P 500</span>
                {sources.includes('sp500') && sp500.data && (
                  <div className="flex items-center gap-1 mt-0.5">
                    <Badge variant="outline" className={sp500.data.stale ? 'bg-yellow-500/20 text-yellow-400 text-[10px]' : 'bg-emerald-500/20 text-emerald-400 text-[10px]'}>
                      {sp500.data.stale ? 'STALE' : 'CURRENT'}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">{sp500.data.count} tickers</span>
                  </div>
                )}
                {sources.includes('sp500') && sp500.isLoading && (
                  <span className="text-[10px] text-muted-foreground">Laddar...</span>
                )}
              </div>
            </label>

            {/* Manual */}
            <label className="flex items-center gap-2 p-3 rounded-lg border cursor-pointer hover:bg-accent/50 transition-colors">
              <Checkbox checked={sources.includes('manual')} onCheckedChange={() => toggleSource('manual')} />
              <Edit3 className="w-4 h-4 text-purple-400" />
              <span className="text-sm font-medium">Manuell lista</span>
            </label>
          </div>

          {sources.includes('sp500') && (
            <div className="p-2 rounded bg-muted/50 text-xs text-muted-foreground flex items-start gap-2">
              <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
              <span>S&P 500-listan baseras på dagens sammansättning och är inte lämpad för historisk backtesting.</span>
            </div>
          )}

          {showManual && (
            <div>
              <Label className="text-xs text-muted-foreground mb-1">Tickers (komma- eller radbrytningsseparerade)</Label>
              <Textarea
                value={manualTickers}
                onChange={(e) => onManualTickersChange(e.target.value)}
                placeholder="AAPL, MSFT, TSLA..."
                className="h-20 text-sm"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                Kombinera
                <Tooltip>
                  <TooltipTrigger><Info className="w-3 h-3" /></TooltipTrigger>
                  <TooltipContent>UNION = alla tickers, INTERSECTION = bara gemensamma</TooltipContent>
                </Tooltip>
              </Label>
              <Select value={combineMode} onValueChange={onCombineModeChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="UNION">Union (alla)</SelectItem>
                  <SelectItem value="INTERSECTION">Intersection (gemensamma)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1">Kandidatgräns</Label>
              <Input
                type="number"
                value={candidateLimit}
                onChange={(e) => onCandidateLimitChange(Number(e.target.value) || 200)}
                min={10}
                max={1000}
              />
            </div>
          </div>

          {sources.includes('sp500') && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => sp500.refetch()}
              disabled={sp500.isFetching}
            >
              <RefreshCw className={`w-3 h-3 mr-1 ${sp500.isFetching ? 'animate-spin' : ''}`} />
              Uppdatera S&P 500
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
