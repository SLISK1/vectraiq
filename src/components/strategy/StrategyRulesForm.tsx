import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Info, RotateCcw, SlidersHorizontal, Shield, DollarSign } from 'lucide-react';

interface RulesFormProps {
  config: Record<string, any>;
  onChange: (key: string, value: any) => void;
  onReset: () => void;
}

function Tip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger><Info className="w-3 h-3 text-muted-foreground" /></TooltipTrigger>
      <TooltipContent className="max-w-[250px] text-xs">{text}</TooltipContent>
    </Tooltip>
  );
}

export function StrategyRulesForm({ config, onChange, onReset }: RulesFormProps) {
  return (
    <div className="space-y-4">
      {/* Quality Gate */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4" /> Kvalitetsfilter
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="flex items-center gap-1 mb-2">
              <Label className="text-xs">TotalScore minimum</Label>
              <Tip text="Lägsta totalpoäng för att en aktie ska bli kandidat. Högre = striktare filter." />
              <span className="text-xs font-mono ml-auto">{config.total_score_min || 65}</span>
            </div>
            <Slider value={[config.total_score_min || 65]} onValueChange={([v]) => onChange('total_score_min', v)} min={40} max={90} step={5} />
          </div>
          <div>
            <div className="flex items-center gap-1 mb-2">
              <Label className="text-xs">Signal-enighet minimum (%)</Label>
              <Tip text="Hur stor andel av modulerna som måste peka åt samma håll." />
              <span className="text-xs font-mono ml-auto">{config.agreement_min || 80}%</span>
            </div>
            <Slider value={[config.agreement_min || 80]} onValueChange={([v]) => onChange('agreement_min', v)} min={50} max={100} step={5} />
          </div>
          <div>
            <div className="flex items-center gap-1 mb-2">
              <Label className="text-xs">Datatäckning minimum (%)</Label>
              <Tip text="Minsta andel av analysmodulerna som har data för denna ticker." />
              <span className="text-xs font-mono ml-auto">{config.coverage_min || 90}%</span>
            </div>
            <Slider value={[config.coverage_min || 90]} onValueChange={([v]) => onChange('coverage_min', v)} min={50} max={100} step={5} />
          </div>
          <div>
            <div className="flex items-center gap-1 mb-2">
              <Label className="text-xs">Max volatilitetsrisk</Label>
              <Tip text="Högsta tillåtna volatilitetsrisk (0-100). Lägre = lugnare aktier." />
              <span className="text-xs font-mono ml-auto">{config.vol_risk_max || 60}</span>
            </div>
            <Slider value={[config.vol_risk_max || 60]} onValueChange={([v]) => onChange('vol_risk_max', v)} min={20} max={100} step={5} />
          </div>
          <div>
            <div className="flex items-center gap-1 mb-2">
              <Label className="text-xs">Max data-ålder (timmar)</Label>
              <Tip text="Om data är äldre än detta blockeras automation." />
              <span className="text-xs font-mono ml-auto">{config.max_staleness_h || 24}h</span>
            </div>
            <Slider value={[config.max_staleness_h || 24]} onValueChange={([v]) => onChange('max_staleness_h', v)} min={1} max={168} step={1} />
          </div>
          <div className="flex items-center gap-3 pt-2 border-t">
            <Switch checked={config.mean_reversion_enabled || false} onCheckedChange={(v) => onChange('mean_reversion_enabled', v)} />
            <div>
              <Label className="text-sm">Aktivera Mean Reversion</Label>
              <p className="text-xs text-muted-foreground">Tillåt kortsiktiga mean-reversion-trades (max 7 dagar)</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Risk Management */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="w-4 h-4" /> Risk & Portfölj
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="flex items-center gap-1 mb-1">
              <Label className="text-xs">Portföljvärde (SEK)</Label>
              <Tip text="Totalt kapital du vill simulera med." />
            </div>
            <Input type="number" value={config.portfolio_value || 100000} onChange={(e) => onChange('portfolio_value', Number(e.target.value))} />
          </div>
          <div>
            <div className="flex items-center gap-1 mb-2">
              <Label className="text-xs">Risk per trade (%)</Label>
              <Tip text="Hur stor del av portföljen du riskerar per trade. 1% rekommenderas." />
              <span className="text-xs font-mono ml-auto">{config.max_risk_pct || 1}%</span>
            </div>
            <Slider value={[config.max_risk_pct || 1]} onValueChange={([v]) => onChange('max_risk_pct', v)} min={0.25} max={2} step={0.25} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Max öppna positioner</Label>
              <Input type="number" value={config.max_open_pos || 5} onChange={(e) => onChange('max_open_pos', Number(e.target.value))} min={1} max={20} />
            </div>
            <div>
              <Label className="text-xs">Max sektorexponering (%)</Label>
              <Input type="number" value={config.max_sector_pct || 30} onChange={(e) => onChange('max_sector_pct', Number(e.target.value))} min={10} max={100} />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-1 mb-1">
              <Label className="text-xs">Execution Policy</Label>
              <Tip text="NEXT_OPEN = entry vid nästa dags öppning (rekommenderas). NEXT_CLOSE = dagens stängning." />
            </div>
            <Select value={config.execution_policy || 'NEXT_OPEN'} onValueChange={(v) => onChange('execution_policy', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="NEXT_OPEN">Nästa dags öppning</SelectItem>
                <SelectItem value="NEXT_CLOSE">Dagens stängning</SelectItem>
                <SelectItem value="LIMIT_AT_SIGNAL_PRICE">Limit vid signalpris</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Costs */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <DollarSign className="w-4 h-4" /> Slippage & Courtage
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="flex items-center gap-1 mb-2">
              <Label className="text-xs">Slippage (bps)</Label>
              <Tip text="Skillnad mellan förväntat och faktiskt pris. 10 bps = 0.1%." />
              <span className="text-xs font-mono ml-auto">{config.slippage_bps || 10} bps</span>
            </div>
            <Slider value={[config.slippage_bps || 10]} onValueChange={([v]) => onChange('slippage_bps', v)} min={0} max={50} step={1} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center gap-1 mb-1">
                <Label className="text-xs">Courtage/trade (SEK)</Label>
                <Tip text="Fast kostnad per trade i SEK." />
              </div>
              <Input type="number" value={config.commission_per_trade || 0} onChange={(e) => onChange('commission_per_trade', Number(e.target.value))} min={0} />
            </div>
            <div>
              <div className="flex items-center gap-1 mb-1">
                <Label className="text-xs">Courtage (bps)</Label>
                <Tip text="Procentuellt courtage i baspunkter." />
              </div>
              <Input type="number" value={config.commission_bps || 0} onChange={(e) => onChange('commission_bps', Number(e.target.value))} min={0} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Button variant="outline" size="sm" onClick={onReset} className="w-full">
        <RotateCcw className="w-3 h-3 mr-1" /> Återställ till standardvärden
      </Button>
    </div>
  );
}
