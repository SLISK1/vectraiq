import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export type JournalDecision = 'buy' | 'sell' | 'skip' | 'watch';
export type JournalStatus = 'open' | 'closed';
export type JournalOutcome = 'win' | 'loss' | 'breakeven' | 'abandoned';

export interface JournalEntry {
  id: string;
  user_id: string;
  symbol_id: string | null;
  ticker: string | null;
  horizon: string | null;
  direction: string | null;
  signal_score: number | null;
  thesis: string;
  decision: JournalDecision;
  conviction: number | null;
  entry_price: number | null;
  stop_loss: number | null;
  target_price: number | null;
  status: JournalStatus;
  outcome: JournalOutcome | null;
  exit_price: number | null;
  realized_return_pct: number | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateJournalEntryInput {
  ticker?: string | null;
  symbol_id?: string | null;
  horizon?: string | null;
  direction?: string | null;
  signal_score?: number | null;
  thesis: string;
  decision: JournalDecision;
  conviction?: number | null;
  entry_price?: number | null;
  stop_loss?: number | null;
  target_price?: number | null;
}

export interface CloseJournalEntryInput {
  id: string;
  outcome: JournalOutcome;
  exit_price?: number | null;
  realized_return_pct?: number | null;
}

// List the current user's journal entries, newest first.
export function useJournalEntries() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['decision-journal', user?.id],
    queryFn: async () => {
      if (!user) return [];

      const { data, error } = await (supabase as any)
        .from('decision_journal')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []) as JournalEntry[];
    },
    enabled: !!user,
  });
}

// Insert a new journal entry for the current user.
export function useCreateJournalEntry() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateJournalEntryInput) => {
      if (!user) throw new Error('Du måste vara inloggad.');

      const { data, error } = await (supabase as any)
        .from('decision_journal')
        .insert({ ...input, user_id: user.id })
        .select()
        .single();

      if (error) throw error;
      return data as JournalEntry;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['decision-journal'] });
    },
  });
}

// Close an open entry: set status='closed' and record the realized outcome.
export function useCloseJournalEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CloseJournalEntryInput) => {
      const { id, ...rest } = input;

      const { data, error } = await (supabase as any)
        .from('decision_journal')
        .update({
          ...rest,
          status: 'closed',
          closed_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as JournalEntry;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['decision-journal'] });
    },
  });
}
