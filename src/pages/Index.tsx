import { useState, useMemo, useCallback } from 'react';
import { Header } from '@/components/Header';
import { HorizonSelector } from '@/components/HorizonSelector';
import { TopRankingList } from '@/components/TopRankingList';
import { RealityCheck } from '@/components/RealityCheck';
import { WatchlistCard } from '@/components/WatchlistCard';
import { StatsPanel } from '@/components/StatsPanel';
import { SettingsPanel } from '@/components/SettingsPanel';
import { AssetDetailModal } from '@/components/AssetDetailModal';
import { AddToWatchlistModal } from '@/components/AddToWatchlistModal';
import { Horizon, RankedAsset, WatchlistCase } from '@/types/market';
import { generateRankedAssets, MOCK_WATCHLIST } from '@/data/mockData';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Star, History, BarChart3 } from 'lucide-react';
import { addDays, addWeeks, addMonths, addYears } from 'date-fns';

const generateId = () => Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

const Index = () => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'watchlist' | 'stats' | 'settings'>('dashboard');
  const [selectedHorizon, setSelectedHorizon] = useState<Horizon>('1w');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<RankedAsset | null>(null);
  const [assetForWatchlist, setAssetForWatchlist] = useState<RankedAsset | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistCase[]>(MOCK_WATCHLIST);
  const { toast } = useToast();

  // Generate ranked assets based on selected horizon
  const topUp = useMemo(() => generateRankedAssets(selectedHorizon, 'UP', 10), [selectedHorizon]);
  const topDown = useMemo(() => generateRankedAssets(selectedHorizon, 'DOWN', 10), [selectedHorizon]);

  const handleRefresh = useCallback(() => {
    setIsLoading(true);
    // Simulate API call
    setTimeout(() => {
      setIsLoading(false);
      toast({
        title: 'Data uppdaterad',
        description: 'Senaste analyserna har laddats.',
      });
    }, 1500);
  }, [toast]);

  const handleAddToWatchlist = (asset: RankedAsset) => {
    setAssetForWatchlist(asset);
  };

  const handleConfirmWatchlist = (asset: RankedAsset, horizon: Horizon) => {
    const getTargetDate = (h: Horizon): Date => {
      const now = new Date();
      switch (h) {
        case '1d': return addDays(now, 1);
        case '1w': return addWeeks(now, 1);
        case '1mo': return addMonths(now, 1);
        case '1y': return addYears(now, 1);
        default: return addWeeks(now, 1);
      }
    };

    const newCase: WatchlistCase = {
      id: generateId(),
      ticker: asset.ticker,
      asset: {
        ticker: asset.ticker,
        name: asset.name,
        type: asset.type,
        sector: asset.sector,
        exchange: asset.exchange,
        currency: asset.currency,
        lastPrice: asset.lastPrice,
        change24h: asset.change24h,
        changePercent24h: asset.changePercent24h,
        volume24h: asset.volume24h,
        marketCap: asset.marketCap,
      },
      savedAt: new Date().toISOString(),
      horizon,
      predictionDirection: asset.direction,
      entryPrice: asset.lastPrice,
      entryPriceSource: 'MarketLens',
      targetEndTime: getTargetDate(horizon).toISOString(),
      confidenceAtSave: asset.confidence,
      modelSnapshotId: `snap-${new Date().toISOString().split('T')[0]}`,
      currentPrice: asset.lastPrice,
      currentReturn: 0,
    };

    setWatchlist(prev => [newCase, ...prev]);
    toast({
      title: 'Tillagd i watchlist',
      description: `${asset.ticker} har lagts till med horisont ${horizon}.`,
    });
  };

  const activeWatchlist = watchlist.filter(w => !w.resultLockedAt);
  const completedWatchlist = watchlist.filter(w => !!w.resultLockedAt);

  return (
    <div className="min-h-screen bg-background">
      <Header activeTab={activeTab} onTabChange={setActiveTab} />

      <main className="container mx-auto px-4 py-6 space-y-6">
        {/* Dashboard */}
        {activeTab === 'dashboard' && (
          <>
            {/* Reality Check */}
            <RealityCheck />

            {/* Horizon Selector */}
            <div className="glass-card rounded-xl p-4">
              <h2 className="text-sm font-medium text-muted-foreground mb-3">Välj analyshorisont</h2>
              <HorizonSelector selected={selectedHorizon} onSelect={setSelectedHorizon} />
            </div>

            {/* Rankings Grid */}
            <div className="grid lg:grid-cols-2 gap-6">
              <TopRankingList
                title="Top 10 UP"
                direction="UP"
                assets={topUp}
                isLoading={isLoading}
                lastUpdated={new Date().toISOString()}
                onAddToWatchlist={handleAddToWatchlist}
                onAssetClick={setSelectedAsset}
                onRefresh={handleRefresh}
              />
              <TopRankingList
                title="Top 10 DOWN"
                direction="DOWN"
                assets={topDown}
                isLoading={isLoading}
                lastUpdated={new Date().toISOString()}
                onAddToWatchlist={handleAddToWatchlist}
                onAssetClick={setSelectedAsset}
                onRefresh={handleRefresh}
              />
            </div>
          </>
        )}

        {/* Watchlist */}
        {activeTab === 'watchlist' && (
          <div className="space-y-6">
            <Tabs defaultValue="active" className="w-full">
              <TabsList className="grid w-full max-w-md grid-cols-2">
                <TabsTrigger value="active" className="gap-2">
                  <Star className="w-4 h-4" />
                  Aktiva ({activeWatchlist.length})
                </TabsTrigger>
                <TabsTrigger value="history" className="gap-2">
                  <History className="w-4 h-4" />
                  Historik ({completedWatchlist.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="active" className="mt-6 space-y-3">
                {activeWatchlist.length === 0 ? (
                  <div className="glass-card rounded-xl p-8 text-center text-muted-foreground">
                    <Star className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>Inga aktiva bevakningar. Lägg till från Dashboard!</p>
                  </div>
                ) : (
                  activeWatchlist.map((wc) => (
                    <WatchlistCard key={wc.id} watchlistCase={wc} />
                  ))
                )}
              </TabsContent>

              <TabsContent value="history" className="mt-6 space-y-3">
                {completedWatchlist.length === 0 ? (
                  <div className="glass-card rounded-xl p-8 text-center text-muted-foreground">
                    <History className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>Ingen historik ännu.</p>
                  </div>
                ) : (
                  completedWatchlist.map((wc) => (
                    <WatchlistCard key={wc.id} watchlistCase={wc} />
                  ))
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}

        {/* Stats */}
        {activeTab === 'stats' && (
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 rounded-lg bg-primary/20">
                <BarChart3 className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Statistik</h2>
                <p className="text-sm text-muted-foreground">Historisk prestanda och kalibrering</p>
              </div>
            </div>
            <StatsPanel />
          </div>
        )}

        {/* Settings */}
        {activeTab === 'settings' && (
          <div className="max-w-2xl mx-auto">
            <SettingsPanel />
          </div>
        )}
      </main>

      {/* Modals */}
      <AssetDetailModal
        asset={selectedAsset}
        isOpen={!!selectedAsset}
        onClose={() => setSelectedAsset(null)}
        onAddToWatchlist={(asset) => {
          setSelectedAsset(null);
          handleAddToWatchlist(asset);
        }}
      />

      <AddToWatchlistModal
        asset={assetForWatchlist}
        isOpen={!!assetForWatchlist}
        onClose={() => setAssetForWatchlist(null)}
        onConfirm={handleConfirmWatchlist}
      />
    </div>
  );
};

export default Index;
