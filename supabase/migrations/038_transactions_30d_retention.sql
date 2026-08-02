-- Cap transaction history retention at 30 days to save storage: run a daily
-- pg_cron job that purges rows older than the window the UI ever displays
-- (Trades tab and Stats tab are both capped to a 30-day lookback).

create extension if not exists pg_cron;

create index if not exists transactions_created_at_idx
  on public.transactions (created_at);

create or replace function public.purge_old_transactions()
returns void language sql security definer as $$
  delete from public.transactions where created_at < now() - interval '30 days';
$$;

select cron.schedule(
  'purge-old-transactions',
  '0 3 * * *',
  $$ select public.purge_old_transactions(); $$
);
