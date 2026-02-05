import { useState } from 'react';
import { Horizon, HORIZON_LABELS, HorizonWeights, DEFAULT_WEIGHTS, MODULE_NAMES } from '@/types/market';
import { cn } from '@/lib/utils';
import { Settings, RotateCcw, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { useToast } from '@/hooks/use-toast';

const editableHorizons: Horizon[] = ['1d', '1w', '1mo', '1y'];
const modules = ['technical', 'fundamental', 'sentiment', 'elliottWave', 'quant', 'macro', 'volatility', 'seasonal', 'orderFlow', 'ml'] as const;

export const SettingsPanel = () => {
  const [selectedHorizon, setSelectedHorizon] = useState<Horizon>('1w');
  const [weights, setWeights] = useState<Record<Horizon, HorizonWeights>>(DEFAULT_WEIGHTS);
  const { toast } = useToast();

  const currentWeights = weights[selectedHorizon];
  const totalWeight = Object.values(currentWeights).reduce((a, b) => a + b, 0);

  const handleWeightChange = (module: keyof HorizonWeights, value: number[]) => {
    setWeights(prev => ({
      ...prev,
      [selectedHorizon]: {
        ...prev[selectedHorizon],
        [module]: value[0],
      },
    }));
  };

  const handleReset = () => {
    setWeights(prev => ({
      ...prev,
      [selectedHorizon]: DEFAULT_WEIGHTS[selectedHorizon],
    }));
    toast({
      title: 'Vikter återställda',
      description: `Vikterna för ${HORIZON_LABELS[selectedHorizon]} har återställts till standard.`,
    });
  };

  const handleSave = () => {
    // In a real app, this would save to backend
    toast({
      title: 'Vikter sparade',
      description: `Nya vikter för ${HORIZON_LABELS[selectedHorizon]} har sparats.`,
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/20">
          <Settings className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Inställningar</h2>
          <p className="text-sm text-muted-foreground">Anpassa viktningen per horisont</p>
        </div>
      </div>

      {/* Horizon Tabs */}
      <div className="flex gap-2 flex-wrap">
        {editableHorizons.map((horizon) => (
          <button
            key={horizon}
            onClick={() => setSelectedHorizon(horizon)}
            className={cn(
              "horizon-badge transition-all duration-200",
              selectedHorizon === horizon
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-accent"
            )}
          >
            {HORIZON_LABELS[horizon]}
          </button>
        ))}
      </div>

      {/* Weight Sliders */}
      <div className="glass-card rounded-xl p-4 space-y-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">Modulvikter för {HORIZON_LABELS[selectedHorizon]}</h3>
          <div className={cn(
            "px-2 py-1 rounded text-sm font-mono",
            totalWeight === 100 ? "bg-up/20 text-up" : "bg-neutral/20 text-neutral"
          )}>
            Summa: {totalWeight}%
          </div>
        </div>

        <div className="space-y-4">
          {modules.map((module) => {
            const value = currentWeights[module];
            return (
              <div key={module} className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>{MODULE_NAMES[module]}</span>
                  <span className="font-mono text-muted-foreground">{value}%</span>
                </div>
                <Slider
                  value={[value]}
                  onValueChange={(v) => handleWeightChange(module, v)}
                  max={100}
                  step={1}
                  className="cursor-pointer"
                />
              </div>
            );
          })}
        </div>

        {totalWeight !== 100 && (
          <div className="p-3 rounded-lg bg-neutral/10 border border-neutral/30 text-sm text-neutral">
            ⚠️ Vikterna summerar till {totalWeight}%. Rekommenderat: 100%
          </div>
        )}

        <div className="flex gap-3 pt-4 border-t border-border/50">
          <Button variant="outline" onClick={handleReset} className="gap-2">
            <RotateCcw className="w-4 h-4" />
            Återställ
          </Button>
          <Button onClick={handleSave} className="gap-2">
            <Save className="w-4 h-4" />
            Spara
          </Button>
        </div>
      </div>

      {/* Info */}
      <div className="glass-card rounded-xl p-4 space-y-3">
        <h3 className="font-semibold">Om viktning</h3>
        <p className="text-sm text-muted-foreground">
          Viktningen avgör hur mycket varje analysmodul påverkar den totala scoren för en tillgång. 
          Högre vikt = större påverkan på slutresultatet.
        </p>
        <ul className="text-sm text-muted-foreground space-y-1">
          <li>• <strong>Korta horisonter (1d):</strong> Teknisk analys och volatilitet viktas högre</li>
          <li>• <strong>Medel (1w-1mo):</strong> Balanserad mix av alla moduler</li>
          <li>• <strong>Långa horisonter (1y):</strong> Fundamental och makroanalys dominerar</li>
        </ul>
      </div>
    </div>
  );
};
