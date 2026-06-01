import { useMemo, useState } from 'react';
import {
  usePaperPortfolio,
  usePaperRealizedTrades,
  usePaperTrades,
  useSetAccountType,
} from '@/hooks/usePaperPortfolio';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AuthModal } from '@/components/AuthModal';
import { cn } from '@/lib/utils';
import { Receipt, AlertTriangle, Loader2, Scale, FileText, Landmark } from 'lucide-react';
import {
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_TYPE_SHORT,
  buildK4Summary,
  compareAccountTypes,
  computeSchablonTax,
  schablonRate,
  ISK_KF_FRIBELOPP_CAPITAL_DEFAULT,
  SCHABLON_FLOOR_RATE,
  STATSLANERANTA_30_NOV_DEFAULT,
  type AccountType,
  type TaxTrade,
} from '@/lib/tax';

const formatSEK = (v: number) =>
  new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK', maximumFractionDigits: 0 }).format(v);
const formatSEK2 = (v: number) =>
  new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK', maximumFractionDigits: 2 }).format(v);
const formatPct = (v: number) => `${(v * 100).toFixed(2)}%`;

export const TaxPanel = () => {
  const { user } = useAuth();
  const { data: portfolioData, isLoading } = usePaperPortfolio();
  const { data: realizedTrades } = usePaperRealizedTrades();
  const { data: recentTrades } = usePaperTrades();
  const setAccountType = useSetAccountType();
  const [authOpen, setAuthOpen] = useState(false);

  const accountType: AccountType = portfolioData?.accountType || 'isk';

  // Capital base (kapitalunderlag) ≈ current total portfolio value. A real ISK
  // kapitalunderlag is the average of quarterly values + deposits/4, but the
  // total value is a reasonable estimate for the simulator.
  const capitalBase = portfolioData?.totalValue ?? 0;

  // Estimated annual realized gains = sum of realized_gain across all sells.
  const estimatedAnnualRealizedGains = useMemo(() => {
    return (realizedTrades || []).reduce((s, t) => s + (Number(t.realized_gain) || 0), 0);
  }, [realizedTrades]);

  // Annual turnover ≈ total traded notional (buys + sells). Uses the recent
  // trades list as a proxy when a full history isn't loaded.
  const annualTurnover = useMemo(() => {
    const sells = (realizedTrades || []).reduce((s, t) => s + Math.abs(Number(t.notional) || 0), 0);
    const buys = (recentTrades || [])
      .filter((t) => t.side === 'buy')
      .reduce((s, t) => s + Math.abs(Number(t.notional) || 0), 0);
    return sells + buys;
  }, [realizedTrades, recentTrades]);

  const k4 = useMemo(() => buildK4Summary((realizedTrades || []) as TaxTrade[]), [realizedTrades]);

  const schablon = useMemo(
    () => computeSchablonTax(capitalBase, { isKf: accountType === 'kf' }),
    [capitalBase, accountType],
  );

  const comparison = useMemo(
    () => compareAccountTypes({ capitalBase, estimatedAnnualRealizedGains, annualTurnover }),
    [capitalBase, estimatedAnnualRealizedGains, annualTurnover],
  );

  const effectiveRate = schablonRate({ isKf: accountType === 'kf' });

  if (!user) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="glass-card rounded-xl p-8 text-center">
          <Receipt className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
          <h3 className="text-lg font-semibold mb-2">Logga in för skatteöversikt</h3>
          <p className="text-muted-foreground mb-4">
            Skatteberäkningen utgår från din paper-portfölj och vald kontotyp.
          </p>
          <Button onClick={() => setAuthOpen(true)}>Logga in</Button>
        </div>
        <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Prominent verify-annually disclaimer */}
      <Alert className="border-yellow-500/50 bg-yellow-500/5">
        <AlertTriangle className="h-4 w-4 text-yellow-500" />
        <AlertTitle>Kontrollera årets schablonränta och fribelopp</AlertTitle>
        <AlertDescription className="text-muted-foreground">
          Alla skattesatser och belopp nedan är <strong>uppskattningar</strong>. Statslåneräntan (30 nov),
          schablonräntans golv (≈1,25%) och det skattefria fribeloppet på ISK/KF (≈150 000 kr 2025,
          ≈300 000 kr 2026) ändras varje år och är politiskt beslutade. Verifiera alltid mot Skatteverket
          för aktuellt år. Detta är inte skatterådgivning.
        </AlertDescription>
      </Alert>

      {/* Account type selector */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Landmark className="w-4 h-4" /> Kontotyp
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <Select
              value={accountType}
              onValueChange={(v) => setAccountType.mutate(v as AccountType)}
              disabled={setAccountType.isPending}
            >
              <SelectTrigger className="w-full sm:w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['isk', 'kf', 'depa'] as AccountType[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {ACCOUNT_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {setAccountType.isPending && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          </div>
          <p className="text-xs text-muted-foreground">
            ISK och KF beskattas med en schablonintäkt på kapitalunderlaget. Depå beskattas i stället per
            affär (reavinst) och redovisas på blankett K4 med omkostnadsbelopp enligt genomsnittsmetoden.
          </p>
        </CardContent>
      </Card>

      {/* Schablonskatt estimate (ISK / KF) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Receipt className="w-4 h-4" /> Schablonskatt (ISK / KF)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="rounded-lg bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground mb-1">Kapitalunderlag</div>
              <div className="font-mono font-bold text-lg">{formatSEK(schablon.capitalBase)}</div>
            </div>
            <div className="rounded-lg bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground mb-1">Schablonränta</div>
              <div className="font-mono font-bold text-lg">{formatPct(effectiveRate)}</div>
            </div>
            <div className="rounded-lg bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground mb-1">Schablonintäkt</div>
              <div className="font-mono font-bold text-lg">{formatSEK(schablon.schablonintakt)}</div>
            </div>
            <div className="rounded-lg bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground mb-1">Skatt (30%)</div>
              <div className="font-mono font-bold text-lg">{formatSEK(schablon.tax)}</div>
            </div>
          </div>
          <div className="text-xs text-muted-foreground space-y-1">
            <p>
              Fribelopp (skattefritt kapital): {formatSEK(schablon.fribelopp)} · Beskattat kapital över
              fribelopp: {formatSEK(schablon.taxableCapitalBase)}
            </p>
            <p>
              Formel: schablonintäkt = max(statslåneränta {formatPct(STATSLANERANTA_30_NOV_DEFAULT)} + 1,0 pp;
              golv {formatPct(SCHABLON_FLOOR_RATE)}) × (kapitalunderlag − fribelopp). Skatt = 30% ×
              schablonintäkt.
              {accountType === 'kf' && (
                <>
                  {' '}
                  KF är avkastningsskatt med likartad schablonmekanik men tas ut hos försäkringsbolaget och
                  saknar ISK:s fribelopp som standard.
                </>
              )}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Depå K4-sammanställning */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="w-4 h-4" /> K4-sammanställning (Avsnitt A — marknadsnoterade aktier)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            Realiserade affärer beräknade med <strong>genomsnittsmetoden</strong> (omkostnadsbelopp =
            genomsnittligt anskaffningsvärde). Gäller vid depå; ISK/KF redovisas inte på K4.
          </p>
          {k4.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Inga realiserade affärer ännu. Sälj ett innehav för att se K4-raderna.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Beteckning</TableHead>
                  <TableHead className="text-right">Antal</TableHead>
                  <TableHead className="text-right">Försäljningspris</TableHead>
                  <TableHead className="text-right">Omkostnadsbelopp</TableHead>
                  <TableHead className="text-right">Vinst</TableHead>
                  <TableHead className="text-right">Förlust</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {k4.rows.map((r) => (
                  <TableRow key={r.beteckning}>
                    <TableCell className="font-medium">{r.beteckning}</TableCell>
                    <TableCell className="text-right font-mono">{r.antal.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-mono">{formatSEK2(r.forsaljningspris)}</TableCell>
                    <TableCell className="text-right font-mono">{formatSEK2(r.omkostnadsbelopp)}</TableCell>
                    <TableCell className={cn('text-right font-mono', r.vinst > 0 && 'text-up')}>
                      {r.vinst > 0 ? formatSEK2(r.vinst) : '—'}
                    </TableCell>
                    <TableCell className={cn('text-right font-mono', r.forlust > 0 && 'text-down')}>
                      {r.forlust > 0 ? formatSEK2(r.forlust) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-semibold">Summa</TableCell>
                  <TableCell />
                  <TableCell className="text-right font-mono font-semibold">
                    {formatSEK2(k4.totalForsaljningspris)}
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold">
                    {formatSEK2(k4.totalOmkostnadsbelopp)}
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold text-up">
                    {formatSEK2(k4.totalVinst)}
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold text-down">
                    {formatSEK2(k4.totalForlust)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )}
          {k4.rows.length > 0 && (
            <p className="text-xs text-muted-foreground mt-3">
              Nettoresultat: {' '}
              <span className={cn('font-mono font-semibold', k4.nettoResultat >= 0 ? 'text-up' : 'text-down')}>
                {formatSEK2(k4.nettoResultat)}
              </span>{' '}
              · Vid vinst tas 30% reavinstskatt ut. Förlust på marknadsnoterade aktier är fullt (100%)
              kvittningsbar mot aktievinster, annars avdragsgill till 70% mot övrig kapitalinkomst.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ISK vs KF vs Depå jämförelse */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Scale className="w-4 h-4" /> ISK-vs-Depå jämförelse (uppskattad årlig skatt)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kontotyp</TableHead>
                <TableHead className="text-right">Uppskattad skatt/år</TableHead>
                <TableHead>Grund</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {comparison.rows.map((row) => (
                <TableRow
                  key={row.accountType}
                  className={cn(row.accountType === comparison.recommended && 'bg-up/5')}
                >
                  <TableCell className="font-medium">
                    {ACCOUNT_TYPE_SHORT[row.accountType]}
                    {row.accountType === comparison.recommended && (
                      <span className="ml-2 text-xs font-medium text-up">lägst skatt</span>
                    )}
                  </TableCell>
                  <TableCell
                    className={cn('text-right font-mono', row.estimatedTax < 0 ? 'text-up' : undefined)}
                  >
                    {formatSEK(row.estimatedTax)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{row.basis}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-lg bg-muted/30 p-3">
              <div className="text-muted-foreground mb-1">Omsättning/år</div>
              <div className="font-mono font-semibold">
                {formatPct(comparison.turnoverRatio)} av kapitalet
                <span className={cn('ml-2', comparison.highTurnover ? 'text-down' : 'text-up')}>
                  ({comparison.highTurnover ? 'hög' : 'låg'})
                </span>
              </div>
            </div>
            <div className="rounded-lg bg-muted/30 p-3">
              <div className="text-muted-foreground mb-1">Uppskattad realiserad vinst/år</div>
              <div
                className={cn(
                  'font-mono font-semibold',
                  estimatedAnnualRealizedGains >= 0 ? 'text-up' : 'text-down',
                )}
              >
                {formatSEK(estimatedAnnualRealizedGains)}
              </div>
            </div>
          </div>

          <Alert>
            <Scale className="h-4 w-4" />
            <AlertTitle>Omsättnings-insikt</AlertTitle>
            <AlertDescription className="text-muted-foreground">{comparison.insight}</AlertDescription>
          </Alert>

          <p className="text-xs text-muted-foreground">
            Antaganden: fribelopp ≈ {formatSEK(ISK_KF_FRIBELOPP_CAPITAL_DEFAULT)} (verifiera årets belopp).
            Depåns skatt baseras på uppskattad realiserad vinst; en förlust visas som negativ skatt
            (skattereduktion via kvittning).
          </p>
        </CardContent>
      </Card>
    </div>
  );
};
