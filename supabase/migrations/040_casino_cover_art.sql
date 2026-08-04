-- Casinos no longer have a separate small logo — theme.backgroundUrl is now
-- the casino's only image, picked from a curated set of cover art (since
-- users can't upload their own images yet). Drop logoUrl from the default
-- and backfill existing rows so nothing is left without a cover.

alter table public.casinos
  alter column theme set default '{"primaryColor":"#7c3aed","backgroundUrl":null}'::jsonb;

update public.casinos
set theme = (theme - 'logoUrl') || jsonb_build_object(
  'backgroundUrl',
  case
    when theme->>'logoUrl' like '%crown%' then '/casino-covers/vegas-skyline.svg'
    when theme->>'logoUrl' like '%spade%' then '/casino-covers/champagne-toast.svg'
    when theme->>'logoUrl' like '%seven%' then '/casino-covers/jackpot-slots.svg'
    when theme->>'logoUrl' like '%dice%' then '/casino-covers/high-roller-dice.svg'
    when theme->>'logoUrl' like '%chip%' then '/casino-covers/neon-roulette.svg'
    when theme->>'logoUrl' like '%star%' then '/casino-covers/champagne-toast.svg'
    else (array[
      '/casino-covers/neon-roulette.svg',
      '/casino-covers/champagne-toast.svg',
      '/casino-covers/jackpot-slots.svg',
      '/casino-covers/high-roller-dice.svg',
      '/casino-covers/vegas-skyline.svg'
    ])[1 + abs(hashtext(id::text)) % 5]
  end
)
where coalesce(theme->>'backgroundUrl', '') = '';
