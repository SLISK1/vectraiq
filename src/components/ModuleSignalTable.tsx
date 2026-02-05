import { ModuleSignal, MODULE_NAMES } from '@/types/market';
import { DirectionBadge } from './DirectionBadge';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronUp, Info } from 'lucide-react';
import { useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface ModuleSignalTableProps {
  signals: ModuleSignal[];
  className?: string;
}

export const ModuleSignalTable = ({ signals, className }: ModuleSignalTableProps) => {
  const [expandedModule, setExpandedModule] = useState<string | null>(null);

  const sortedSignals = [...signals].sort((a, b) => b.weight - a.weight);

  return (
    <div className={cn("glass-card rounded-xl overflow-hidden", className)}>
      <table className="data-table">
        <thead>
          <tr className="bg-muted/30">
            <th>Modul</th>
            <th>Signal</th>
            <th className="text-center">Styrka</th>
            <th className="text-center">Konfidens</th>
            <th className="text-center">Vikt</th>
            <th className="text-center">Täckning</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sortedSignals.map((signal) => (
            <Collapsible
              key={signal.module}
              open={expandedModule === signal.module}
              onOpenChange={(open) => setExpandedModule(open ? signal.module : null)}
              asChild
            >
              <>
                <CollapsibleTrigger asChild>
                  <tr className="cursor-pointer">
                    <td className="font-medium">{MODULE_NAMES[signal.module]}</td>
                    <td>
                      <DirectionBadge direction={signal.direction} size="sm" />
                    </td>
                    <td className="text-center">
                      <div className="inline-flex items-center gap-2">
                        <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={cn(
                              "h-full rounded-full",
                              signal.direction === 'UP' ? "bg-up" : signal.direction === 'DOWN' ? "bg-down" : "bg-neutral"
                            )}
                            style={{ width: `${signal.strength}%` }}
                          />
                        </div>
                        <span className="font-mono text-sm">{signal.strength}</span>
                      </div>
                    </td>
                    <td className="text-center">
                      <span className={cn(
                        "font-mono text-sm",
                        signal.confidence >= 70 ? "text-up" : signal.confidence >= 50 ? "text-neutral" : "text-down"
                      )}>
                        {signal.confidence}%
                      </span>
                    </td>
                    <td className="text-center">
                      <span className="font-mono text-sm text-muted-foreground">{signal.weight}%</span>
                    </td>
                    <td className="text-center">
                      <span className={cn(
                        "font-mono text-sm",
                        signal.coverage >= 80 ? "text-up" : signal.coverage >= 60 ? "text-neutral" : "text-down"
                      )}>
                        {signal.coverage}%
                      </span>
                    </td>
                    <td className="text-right">
                      {expandedModule === signal.module ? (
                        <ChevronUp className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      )}
                    </td>
                  </tr>
                </CollapsibleTrigger>
                
                <CollapsibleContent asChild>
                  <tr className="bg-muted/20">
                    <td colSpan={7} className="py-3">
                      <div className="px-2 space-y-2">
                        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                          <Info className="w-4 h-4" />
                          Evidens ({signal.evidence.length} datapunkter)
                        </div>
                        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                          {signal.evidence.map((e, i) => (
                            <div key={i} className="p-2 rounded-lg bg-background/50 text-sm">
                              <div className="flex items-center justify-between mb-1">
                                <span className="font-medium">{e.description}</span>
                                <span className="font-mono text-primary">{e.value}</span>
                              </div>
                              <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>{e.source}</span>
                                <span>{new Date(e.timestamp).toLocaleDateString('sv-SE')}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </td>
                  </tr>
                </CollapsibleContent>
              </>
            </Collapsible>
          ))}
        </tbody>
      </table>
    </div>
  );
};
