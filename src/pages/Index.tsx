import { useState, useCallback, useMemo, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Header } from '@/components/Header';
import { HorizonSelector } from '@/components/HorizonSelector';
import { TopRankingList } from '@/components/TopRankingList';
import { RealityCheck } from '@/components/RealityCheck';
import { WatchlistCard } from '@/components/WatchlistCard';
import { StatsPanel } from '@/components/StatsPanel';
import { SettingsPanel } from '@/components/SettingsPanel';
import { AssetDetailModal } from '@/components/AssetDetailModal';
import { AddToWatchlistModal } from '@/components/AddToWatchlistModal';
import { AuthModal } from '@/components/AuthModal';
import { MarketCapFilter } from '@/components/MarketCapFilter';
import { AssetTypeFilter } from '@/components/AssetTypeFilter';
import { SearchAssets } from '@/components/SearchAssets';
import { PortfolioView } from '@/components/PortfolioView';
import { ScreenerPage } from '@/pages/ScreenerPage';
import { BettingPage } from '@/pages/BettingPage';
import { PaperPortfolioPage } from '@/components/paper/PaperPortfolioPage';
import { PaperTradeModal } from '@/components/paper/PaperTradeModal';
import { Horizon, RankedAsset, WatchlistCase, HORIZON_LABELS, MarketCapCategory, AssetType } from '@/types/market';
import type { TabId } from '@/components/Header';
import { useAuth } from '@/contexts/AuthContext';
import { useRankedAssets, useWatchlist, useAddToWatchlist, useRefreshPrices, useSymbols, useAddSymbol } from '@/hooks/useMarketData';
import { usePriceRealtime } from '@/hooks/usePriceRealtime';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Star, History, BarChart3, Loader2, Briefcase, Wallet, Database } from 'lucide-react';

const Index = () => {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [selectedHorizon, setSelectedHorizon] = useState<Horizon>('1w');
  const [selectedMarketCap, setSelectedMarketCap] = useState<MarketCapCategory>('all');
  const [selectedAssetType, setSelectedAssetType] = useState<AssetType | 'all'>('all');
  const [selectedAsset, setSelectedAsset] = useState<RankedAsset | null>(null);
  const [assetForWatchlist, setAssetForWatchlist] = useState<RankedAsset | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [paperTradeAsset, setPaperTradeAsset] = useState<{ symbolId: string; ticker: string; name: string; lastPrice: number; assetType: string } | null>(null);
  const { user } = useAuth();
  const { toast } = useToast();
  
  // Enable realtime price updates
  usePriceRealtime();

  // Firecrawl budget for stocks
  const [stockBudget, setStockBudget] = useState<{ searches_used: number } | null>(null);
  useEffect(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    supabase
      .from('api_usage_tracker')
      .select('searches_used')
      .eq('category', 'stocks')
      .eq('date_key', todayStr)
      .single()
      .then(({ data }) => {
        setStockBudget({ searches_used: (data as any)?.searches_used || 0 });
      });
  }, []);

  // Data hooks
  const { data: topUp, isLoading: loadingUp } = useRankedAssets(selectedHorizon, 'UP');
  const { data: topDown, isLoading: loadingDown } = useRankedAssets(selectedHorizon, 'DOWN');
  const { data: symbols } = useSymbols();
  const { data: watchlistData, isLoading: loadingWatchlist } = useWatchlist();
  const addToWatchlistMutation = useAddToWatchlist();
  const refreshPricesMutation = useRefreshPrices();
  const addSymbolMutation = useAddSymbol();

  // Auto-refresh prices on mount if user is logged in and data is stale
  useEffect(() => {
    if (user && !refreshPricesMutation.isPending) {
      // Check if prices need refresh (do it once on mount)
      const lastRefresh = sessionStorage.getItem('lastPriceRefresh');
      const now = Date.now();
      const fiveMinutes = 5 * 60 * 1000;
      
      if (!lastRefresh || now - parseInt(lastRefresh) > fiveMinutes) {
        console.log('[Index] Auto-refreshing prices...');
        refreshPricesMutation.mutate(undefined, {
          onSuccess: () => {
            sessionStorage.setItem('lastPriceRefresh', now.toString());
            console.log('[Index] Price refresh complete');
          },
          onError: (err) => {
            console.log('[Index] Price refresh failed:', err);
          }
        });
      }
    }
  }, [user]); // Only run on mount/user change

  // Transform database watchlist to component format
  const transformedWatchlist: WatchlistCase[] = (watchlistData || []).map(wc => {
    const symbol = symbols?.find(s => s.id === wc.symbol_id);
    const latestPrice = symbol?.latestPrice;
    
    return {
      id: wc.id,
      ticker: symbol?.ticker || 'N/A',
      asset: {
        ticker: symbol?.ticker || 'N/A',
        name: symbol?.name || 'Unknown',
        type: (symbol?.asset_type || 'stock') as 'stock' | 'crypto' | 'metal',
        sector: symbol?.sector || undefined,
        exchange: symbol?.exchange || undefined,
        currency: symbol?.currency || 'SEK',
        lastPrice: latestPrice ? Number(latestPrice.price) : Number(wc.entry_price),
        change24h: latestPrice ? Number(latestPrice.change_24h || 0) : 0,
        changePercent24h: latestPrice ? Number(latestPrice.change_percent_24h || 0) : 0,
        volume24h: latestPrice ? Number(latestPrice.volume || 0) : 0,
      },
      savedAt: wc.created_at,
      horizon: wc.horizon as Horizon,
      predictionDirection: wc.prediction_direction as 'UP' | 'DOWN' | 'NEUTRAL',
      entryPrice: Number(wc.entry_price),
      entryPriceSource: wc.entry_price_source,
      targetEndTime: wc.target_end_time,
      confidenceAtSave: wc.confidence_at_save,
      modelSnapshotId: wc.model_snapshot_id || '',
      currentPrice: latestPrice ? Number(latestPrice.price) : undefined,
      currentReturn: latestPrice 
        ? ((Number(latestPrice.price) - Number(wc.entry_price)) / Number(wc.entry_price)) * 100 
        : undefined,
      exitPrice: wc.exit_price ? Number(wc.exit_price) : undefined,
      returnPct: wc.return_pct ? Number(wc.return_pct) : undefined,
      hit: wc.hit ?? undefined,
      resultLockedAt: wc.result_locked_at ?? undefined,
    };
  });

  const handleRefresh = useCallback(async () => {
    try {
      await refreshPricesMutation.mutateAsync();
      toast({
        title: 'Data uppdaterad',
        description: 'Senaste priserna har hämtats.',
      });
    } catch (error) {
      toast({
        title: 'Fel',
        description: 'Kunde inte uppdatera priser.',
        variant: 'destructive',
      });
    }
  }, [refreshPricesMutation, toast]);

  const handleSimulateTrade = useCallback((asset: RankedAsset) => {
    if (!user) {
      setShowAuthModal(true);
      return;
    }
    const symbol = symbols?.find(s => s.ticker === asset.ticker);
    if (!symbol) return;
    setPaperTradeAsset({
      symbolId: symbol.id,
      ticker: asset.ticker,
      name: asset.name,
      lastPrice: asset.lastPrice,
      assetType: asset.type,
    });
  }, [user, symbols]);

  const handleAddToWatchlist = (asset: RankedAsset) => {
    if (!user) {
      setShowAuthModal(true);
      toast({
        title: 'Logga in krävs',
        description: 'Du måste vara inloggad för att spara till watchlist.',
      });
      return;
    }
    setAssetForWatchlist(asset);
  };

  const handleConfirmWatchlist = async (asset: RankedAsset, horizon: Horizon) => {
    try {
      await addToWatchlistMutation.mutateAsync({ asset, horizon });
      toast({
        title: 'Tillagd i watchlist',
        description: `${asset.ticker} har lagts till med horisont ${HORIZON_LABELS[horizon]}.`,
      });
    } catch (error) {
      toast({
        title: 'Fel',
        description: 'Kunde inte lägga till i watchlist.',
        variant: 'destructive',
      });
    }
  };

  const activeWatchlist = transformedWatchlist.filter(w => !w.resultLockedAt);
  const completedWatchlist = transformedWatchlist.filter(w => !!w.resultLockedAt);
  const isLoading = loadingUp || loadingDown;

  // Transform symbols for search
  const searchableAssets = useMemo(() => {
    return (symbols || []).map(s => ({
      id: s.id,
      ticker: s.ticker,
      name: s.name,
      type: (s.asset_type || 'stock') as AssetType,
      price: s.latestPrice ? Number(s.latestPrice.price) : undefined,
      changePercent: s.latestPrice ? Number(s.latestPrice.change_percent_24h || 0) : undefined,
      currency: s.currency,
    }));
  }, [symbols]);

  // Handle search selection - find in ranked assets or create basic view
  const handleSearchSelect = useCallback((asset: { id: string; ticker: string; name: string; type: AssetType; price?: number; changePercent?: number; currency?: string }) => {
    // Try to find in ranked assets first
    const rankedAsset = [...(topUp || []), ...(topDown || [])].find(a => a.ticker === asset.ticker);
    if (rankedAsset) {
      setSelectedAsset(rankedAsset);
    } else {
      // Create a basic RankedAsset for viewing
      const symbol = symbols?.find(s => s.ticker === asset.ticker);
      if (symbol) {
        const basicAsset: RankedAsset = {
          ticker: symbol.ticker,
          name: symbol.name,
          type: (symbol.asset_type || 'stock') as AssetType,
          sector: symbol.sector || undefined,
          exchange: symbol.exchange || undefined,
          currency: symbol.currency || 'SEK',
          lastPrice: asset.price || 0,
          change24h: 0,
          changePercent24h: asset.changePercent || 0,
          volume24h: 0,
          totalScore: 50,
          direction: 'NEUTRAL',
          confidence: 30,
          confidenceBreakdown: { freshness: 50, coverage: 30, agreement: 50, reliability: 50, regimeRisk: 50 },
          signals: [],
          topContributors: [],
          horizon: selectedHorizon,
          lastUpdated: new Date().toISOString(),
        };
        setSelectedAsset(basicAsset);
      }
    }
  }, [topUp, topDown, symbols, selectedHorizon]);

  // Handle adding new symbol
  const queryClient = useQueryClient();

  const handleAddNewSymbol = useCallback(async (ticker: string) => {
    try {
      const result = await addSymbolMutation.mutateAsync(ticker);
      const name = result.displayName || ticker;
      toast({
        title: result.isNew ? "Tillgång tillagd!" : "Tillgång finns redan",
        description: result.isNew 
          ? `${name} (${ticker}) har lagts till som ${result.detectedType}. Historik, priser och signaler hämtas i bakgrunden — tillgången dyker upp inom ca 30 sekunder.`
          : `${ticker} finns redan i systemet.`,
      });
      // Auto-invalidate after 30s so signals/prices appear
      if (result.isNew) {
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ['symbols'] });
          queryClient.invalidateQueries({ queryKey: ['rankedAssets'] });
        }, 30000);
      }
    } catch (error) {
      toast({
        title: "Kunde inte lägga till tillgång",
        description: `Det gick inte att lägga till ${ticker}. Kontrollera att tickern är korrekt.`,
        variant: "destructive",
      });
    }
  }, [addSymbolMutation, toast, queryClient]);

  // Filter assets by market cap and asset type
  const filteredTopUp = useMemo(() => {
    if (!topUp) return [];
    
    // Special "rocket" filter: Top 10 by confidence * predicted growth
    if (selectedMarketCap === 'rocket') {
      const allAssets = [...(topUp || [])];
      // Sort by confidence * predicted month/year return
      return allAssets
        .filter(a => selectedAssetType === 'all' || a.type === selectedAssetType)
        .map(a => ({
          asset: a,
          // Calculate rocket score: confidence * max of month/year predicted return
          rocketScore: a.confidence * Math.max(
            Math.abs(a.predictedReturns?.year1 || 0),
            Math.abs((a.predictedReturns?.week1 || 0) * 4) // Extrapolate week to month
          )
        }))
        .sort((a, b) => b.rocketScore - a.rocketScore)
        .slice(0, 10)
        .map(r => r.asset);
    }
    
    return topUp.filter(a => {
      const matchesMarketCap = selectedMarketCap === 'all' || a.marketCapCategory === selectedMarketCap;
      const matchesAssetType = selectedAssetType === 'all' || a.type === selectedAssetType;
      return matchesMarketCap && matchesAssetType;
    }).slice(0, 10);
  }, [topUp, selectedMarketCap, selectedAssetType]);

  const filteredTopDown = useMemo(() => {
    if (!topDown) return [];
    
    // For rocket mode, don't show DOWN list - rocket is about growth
    if (selectedMarketCap === 'rocket') {
      return [];
    }
    
    return topDown.filter(a => {
      const matchesMarketCap = selectedMarketCap === 'all' || a.marketCapCategory === selectedMarketCap;
      const matchesAssetType = selectedAssetType === 'all' || a.type === selectedAssetType;
      return matchesMarketCap && matchesAssetType;
    }).slice(0, 10);
  }, [topDown, selectedMarketCap, selectedAssetType]);

  return (
    <div className="min-h-screen bg-background">
      <Header activeTab={activeTab} onTabChange={setActiveTab} />

      <main className="container mx-auto px-4 py-6 space-y-6">
        {/* Dashboard */}
        {activeTab === 'dashboard' && (
          <>
            {/* Reality Check */}
            <RealityCheck />

            {/* Firecrawl Budget Meter */}
            {stockBudget && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/30 border border-border">
                <Database className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground">Firecrawl-budget (Aktier) idag</p>
                    <span className="text-xs font-semibold">
                      {stockBudget.searches_used} / 15 sökningar
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        stockBudget.searches_used > 13 ? 'bg-destructive' : stockBudget.searches_used > 10 ? 'bg-yellow-500' : 'bg-primary'
                      }`}
                      style={{ width: `${Math.min(100, (stockBudget.searches_used / 15) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Search */}
            <div className="glass-card rounded-xl p-4 overflow-visible relative z-20">
              <h2 className="text-sm font-medium text-muted-foreground mb-3">Sök tillgång</h2>
              <SearchAssets 
                assets={searchableAssets} 
                onSelect={handleSearchSelect}
                onAddNew={handleAddNewSymbol}
                isAdding={addSymbolMutation.isPending}
                placeholder="Sök aktie, fond, krypto eller metall..."
              />
            </div>

            {/* Filters */}
            <div className="glass-card rounded-xl p-4 space-y-4">
              <div>
                <h2 className="text-sm font-medium text-muted-foreground mb-3">Välj analyshorisont</h2>
                <HorizonSelector selected={selectedHorizon} onSelect={setSelectedHorizon} />
              </div>
              <div>
                <h2 className="text-sm font-medium text-muted-foreground mb-3">Filtrera på börsvärde</h2>
                <MarketCapFilter selected={selectedMarketCap} onSelect={setSelectedMarketCap} />
              </div>
              <div>
                <h2 className="text-sm font-medium text-muted-foreground mb-3">Filtrera på tillgångstyp</h2>
                <AssetTypeFilter selected={selectedAssetType} onSelect={setSelectedAssetType} />
              </div>
            </div>

            {/* Rankings Grid */}
            <div className={selectedMarketCap === 'rocket' ? '' : 'grid lg:grid-cols-2 gap-6'}>
              <TopRankingList
                title={selectedMarketCap === 'rocket' ? '🚀 Top 10 Raket - Högst konfidens & tillväxtpotential' : 'Top 10 UP'}
                direction="UP"
                assets={filteredTopUp}
                isLoading={isLoading}
                lastUpdated={new Date().toISOString()}
                onAddToWatchlist={handleAddToWatchlist}
                onAssetClick={setSelectedAsset}
                onSimulateTrade={handleSimulateTrade}
                onRefresh={handleRefresh}
              />
              {selectedMarketCap !== 'rocket' && (
                <TopRankingList
                  title="Top 10 DOWN"
                  direction="DOWN"
                  assets={filteredTopDown}
                  isLoading={isLoading}
                  lastUpdated={new Date().toISOString()}
                  onAddToWatchlist={handleAddToWatchlist}
                  onAssetClick={setSelectedAsset}
                  onSimulateTrade={handleSimulateTrade}
                />
              )}
            </div>
          </>
        )}

        {/* Watchlist */}
        {activeTab === 'watchlist' && (
          <div className="space-y-6">
            {!user ? (
              <div className="glass-card rounded-xl p-8 text-center">
                <Star className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                <h3 className="text-lg font-semibold mb-2">Logga in för att se din watchlist</h3>
                <p className="text-muted-foreground mb-4">
                  Skapa ett konto för att spara tillgångar och följa dina prediktioner.
                </p>
                <button
                  onClick={() => setShowAuthModal(true)}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
                >
                  Logga in
                </button>
              </div>
            ) : loadingWatchlist ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : (
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
            )}
          </div>
        )}

        {/* Portfolio */}
        {activeTab === 'portfolio' && (
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 rounded-lg bg-primary/20">
                <Briefcase className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Portfolio</h2>
                <p className="text-sm text-muted-foreground">Dina innehav och deras utveckling</p>
              </div>
            </div>
            <PortfolioView />
          </div>
        )}

        {/* Screener */}
        {activeTab === 'screener' && <ScreenerPage />}

        {/* Betting */}
        {activeTab === 'betting' && <BettingPage />}

        {/* Paper Portfolio */}
        {activeTab === 'paper' && (
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 rounded-lg bg-primary/20">
                <Wallet className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Paper Portfolio</h2>
                <p className="text-sm text-muted-foreground">Simulerad handel med låtsaspengar</p>
              </div>
            </div>
            <PaperPortfolioPage />
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
        onSimulateTrade={(asset) => {
          setSelectedAsset(null);
          handleSimulateTrade(asset);
        }}
      />

      <AddToWatchlistModal
        asset={assetForWatchlist}
        isOpen={!!assetForWatchlist}
        onClose={() => setAssetForWatchlist(null)}
        onConfirm={handleConfirmWatchlist}
      />

      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />

      {/* Paper Trade Modal */}
      {paperTradeAsset && (
        <PaperTradeModal
          isOpen={!!paperTradeAsset}
          onClose={() => setPaperTradeAsset(null)}
          symbolId={paperTradeAsset.symbolId}
          ticker={paperTradeAsset.ticker}
          name={paperTradeAsset.name}
          lastPrice={paperTradeAsset.lastPrice}
          currency="SEK"
          assetType={paperTradeAsset.assetType}
        />
      )}
    </div>
  );
};

export default Index;
