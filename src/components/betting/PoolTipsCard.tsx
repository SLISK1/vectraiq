import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';

import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, RefreshCw, Copy, Save, AlertTriangle, Lock, Scale, RotateCcw } from 'lucide-react';

interface PoolTipsCardProps {
  poolType: 'topptipset' | 'stryktipset';
  poolData: any;
  isLoading: boolean;
  onFetch: (maxRows: number, budgetSek: number) => void;
  isLoggedIn: boolean;
  userId?: string;
}

export const PoolTipsCard = ({ poolType, poolData, isLoading, onFetch, isLoggedIn, userId }: PoolTipsCardProps) => {
  const [maxRows, setMaxRows] = useState(64);
  const [budgetSek, setBudgetSek] = useState(64);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const ticketPrice = poolType === 'topptipset' ? 1.0 : 0.5;
  const maxCost = maxRows * ticketPrice;

  const handleCopy = () => {
    if (!poolData?.clipboard_string) return;
    navigator.clipboard.writeText(poolData.clipboard_string);
    toast({ title: 'Kopierat', description: 'Systemraden har kopierats till urklipp.' });
  };

  const handleSave = async () => {
    if (!isLoggedIn || !userId || !poolData) return;
    setIsSaving(true);
    try {
      const { error } = await supabase.from('pool_tickets').insert({
        user_id: userId,
        pool_type: poolType,
        round_id: poolData.round_id || `${poolType}-${Date.now()}`,
        round_name: poolData.round_name || '',
        rows_json: poolData.rows || [],
        system_size: poolData.system_size || 1,
        budget_sek: budgetSek,
      });

      if (error) throw error;
      toast({ title: 'Sparad', description: 'Din kupong har sparats.' });
    } catch {
      toast({ title: 'Fel', description: 'Kunde inte spara kupongen.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const getSystemIcon = (type: string) => {
    if (type === 'spike') return <Lock className="w-3 h-3 text-primary" />;
    if (type === 'half') return <Scale className="w-3 h-3 text-muted-foreground" />;
    return <RotateCcw className="w-3 h-3 text-destructive" />;
  };

  const getSystemLabel = (type: string) => {
    if (type === 'spike') return '🔒 Spik';
    if (type === 'half') return '⚖️ Halvgardering';
    return '🔄 Helgardering';
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 65) return 'bg-primary';
    if (confidence >= 50) return 'bg-muted-foreground';
    return 'bg-destructive';
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="glass-card rounded-xl p-5 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold capitalize">
            {poolType === 'topptipset' ? 'Topptipset' : 'Stryktipset'}
          </h2>
          {poolData?.round_name && (
            <Badge variant="outline">{poolData.round_name}</Badge>
          )}
        </div>

        <div className="grid sm:grid-cols-2 gap-5">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm text-muted-foreground">Max antal rader</label>
              <span className="text-sm font-bold">{maxRows}</span>
            </div>
            <Slider
              value={[maxRows]}
              onValueChange={([v]) => setMaxRows(v)}
              min={1}
              max={128}
              step={1}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground mt-1">Max kostnad: {maxCost.toFixed(2)} kr</p>
          </div>

          <div>
            <label className="text-sm text-muted-foreground block mb-2">Budget (SEK)</label>
            <input
              type="number"
              value={budgetSek}
              onChange={(e) => setBudgetSek(Number(e.target.value))}
              min={1}
              max={1000}
              className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>

        <Button
          onClick={() => onFetch(maxRows, budgetSek)}
          disabled={isLoading}
          className="w-full gap-2"
        >
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {isLoading ? 'Hämtar & analyserar...' : 'Hämta aktuell omgång'}
        </Button>
      </div>

      {/* Results */}
      {poolData && (
        <>
          {/* System Summary */}
          <div className="glass-card rounded-xl p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <p className="text-2xl font-bold font-mono">{poolData.system_size}</p>
                  <p className="text-xs text-muted-foreground">rader</p>
                </div>
                <div className="h-10 w-px bg-border" />
                <div className="text-center">
                  <p className="text-2xl font-bold font-mono">{poolData.cost_sek?.toFixed(2)}</p>
                  <p className="text-xs text-muted-foreground">kr</p>
                </div>
                {poolData.over_budget && (
                  <>
                    <div className="h-10 w-px bg-border" />
                    <div className="flex items-center gap-1.5 text-destructive">
                      <AlertTriangle className="w-4 h-4" />
                      <span className="text-sm">Överskrider budget</span>
                    </div>
                  </>
                )}
              </div>

              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={handleCopy} className="gap-1.5">
                  <Copy className="w-3.5 h-3.5" />
                  Kopiera
                </Button>
                {isLoggedIn && (
                  <Button size="sm" onClick={handleSave} disabled={isSaving} className="gap-1.5">
                    {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    Spara
                  </Button>
                )}
              </div>
            </div>

            {poolData.clipboard_string && (
              <div className="mt-3 rounded-md bg-muted/50 px-3 py-2">
                <p className="text-xs text-muted-foreground mb-1">Systemrad:</p>
                <p className="font-mono text-sm break-all">{poolData.clipboard_string}</p>
              </div>
            )}
          </div>

          {/* Match Rows */}
          {poolData.rows?.length > 0 ? (
            <div className="space-y-2">
              {poolData.rows.map((row: any, i: number) => (
                <div key={i} className="glass-card rounded-xl p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-bold text-muted-foreground">#{row.match_number}</span>
                        {row.match_date && (
                          <span className="text-xs text-muted-foreground">
                            {new Date(row.match_date).toLocaleDateString('sv-SE', { weekday: 'short', month: 'short', day: 'numeric' })}
                          </span>
                        )}
                      </div>
                      <p className="font-semibold text-sm">{row.home_team} — {row.away_team}</p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {getSystemIcon(row.system_type)}
                      <span className="text-xs">{getSystemLabel(row.system_type)}</span>
                    </div>
                  </div>

                  {/* Probabilities */}
                  <div className="flex gap-2 text-xs">
                    {[
                      { label: '1', value: row.prob_home },
                      { label: 'X', value: row.prob_draw },
                      { label: '2', value: row.prob_away },
                    ].map((opt) => (
                      <div
                        key={opt.label}
                        className={`flex-1 text-center rounded-md py-1.5 border ${
                          row.signs.includes(opt.label)
                            ? 'bg-primary/20 border-primary/50 text-primary font-bold'
                            : 'bg-muted/30 border-border/30 text-muted-foreground'
                        }`}
                      >
                        <p>{opt.label}</p>
                        <p>{opt.value}%</p>
                      </div>
                    ))}
                  </div>

                  {/* Confidence bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Konfidens</span>
                      <span>{row.confidence}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${getConfidenceColor(row.confidence)}`}
                        style={{ width: `${row.confidence}%` }}
                      />
                    </div>
                  </div>

                  {row.reasoning && (
                    <p className="text-xs text-muted-foreground italic">{row.reasoning}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="glass-card rounded-xl p-8 text-center text-muted-foreground">
              <p>{poolData.message || 'Ingen aktiv omgång hittades.'}</p>
            </div>
          )}
        </>
      )}

      {!poolData && !isLoading && (
        <div className="glass-card rounded-xl p-12 text-center">
          <p className="text-muted-foreground mb-2">Klicka på "Hämta aktuell omgång" för att analysera</p>
          <p className="text-xs text-muted-foreground">
            Hämtar matchdata från Svenska Spel och genererar AI-tips med systemrad.
          </p>
        </div>
      )}
    </div>
  );
};
