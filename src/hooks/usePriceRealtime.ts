import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { SymbolWithPrice } from '@/lib/api/database';

type RawPrice = Tables<'raw_prices'>;

export const usePriceRealtime = () => {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel('price-updates')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'raw_prices',
        },
        (payload) => {
          const newPrice = payload.new as RawPrice;
          
          // Update the symbols cache with the new price
          queryClient.setQueryData<SymbolWithPrice[]>(['symbols'], (oldData) => {
            if (!oldData) return oldData;
            
            return oldData.map((symbol) => {
              if (symbol.id === newPrice.symbol_id) {
                return {
                  ...symbol,
                  latestPrice: newPrice,
                };
              }
              return symbol;
            });
          });

          console.log(`[Realtime] Price updated for symbol ${newPrice.symbol_id}: ${newPrice.price}`);
        }
      )
      .subscribe((status) => {
        console.log('[Realtime] Subscription status:', status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
};
