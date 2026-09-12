# Chip Requests + Notifications — Design Spec

**Date:** 2026-09-12
**Status:** Approved (design)

## Goal

Make the lobby's "Get chips" button (currently inert, `LobbyTopBar.tsx`) open a
popup where a member can request a specific chip amount. The request appears
on the casino's Trades page for an admin/owner to accept or deny. Accepting
grants the exact requested amount; denying does nothing to the balance.
Resolving a request (either way) notifies the requester via a new
notification bell in the lobby top bar (currently also inert), which also
notifies admins/owner when a new request comes in.

## Background

The only existing cross-user chip movement is the admin-initiated
`give_chips` / `remove_chips` RPC pair, surfaced via the "Trades" tab
(`docs/superpowers/specs/2026-07-05-chip-ledger-design.md`). There is no
member-initiated flow today, and no notification system at all — the bell
icon in `LobbyTopBar.tsx` and the "Get chips" button are both marked
`{/* No functionality yet. */}`.

## Scope

- A member can submit one pending chip request at a time, for themself, via
  a "Get chips" popup.
- An admin/owner sees every pending request in the casino on the Trades page
  and can Accept (grants the exact amount) or Deny (no balance change).
- The requester can Cancel their own still-pending request.
- A generic `notifications` table/RPC pair, fed today only by the chip
  request lifecycle: request created (→ admins/owner), request
  accepted/denied (→ requester). The bell shows a red dot while any
  notification is unread; opening the bell's popup marks all as read.
- An accepted request becomes a normal `transactions` row (reusing
  `give_chips`'s balance-update pattern) and therefore needs no changes to
  the existing ledger/`list_chip_transactions` — it just shows up. A denied
  request never touches balances, so its only record is the notification.

Out of scope: peer-to-peer transfers, editing the requested amount before
accepting (admin either accepts the exact amount or denies), realtime push
(bell state is fetched on lobby load, not subscribed), notification types
other than the chip-request ones, paginating/pruning old notifications.

## Database

### Migration `051_chip_requests.sql`

```sql
-- One pending request per member per casino, enforced at the DB level.
create table public.chip_requests (
  id uuid primary key default gen_random_uuid(),
  casino_id uuid not null references public.casinos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending','accepted','denied')),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index chip_requests_one_pending_per_member
  on public.chip_requests (casino_id, user_id)
  where status = 'pending';

alter table public.chip_requests enable row level security;
-- No policies: every read/write goes through the security definer RPCs
-- below, which (like give_chips/remove_chips) run as the function owner
-- and so bypass RLS. Mirrors the "RPC-only" access shape already used for
-- transactions' aggregate reads.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  casino_id uuid not null references public.casinos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('chip_request_created', 'chip_request_accepted', 'chip_request_denied')),
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_unread_idx on public.notifications (user_id, casino_id) where read_at is null;

alter table public.notifications enable row level security;
-- No direct policies either; RPC-only, same reasoning as above.
```

### RPCs

```sql
create or replace function public.request_chips(p_casino_id uuid, p_amount numeric(14,2))
returns public.chip_requests
language plpgsql security definer as $$
declare
  v_request public.chip_requests;
  v_username text;
begin
  if p_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;

  if not exists (
    select 1 from public.casino_members
    where casino_id = p_casino_id and user_id = auth.uid()
  ) then
    raise exception 'Not a member of this casino';
  end if;

  insert into public.chip_requests (casino_id, user_id, amount)
  values (p_casino_id, auth.uid(), p_amount)
  returning * into v_request;
  -- The partial unique index raises a unique_violation here if a pending
  -- request already exists; the client surfaces this as a friendly message
  -- rather than a raw Postgres error (see Frontend below).

  select username into v_username from public.profiles where id = auth.uid();

  insert into public.notifications (casino_id, user_id, type, payload)
  select p_casino_id, recipient, 'chip_request_created',
         jsonb_build_object('request_id', v_request.id, 'amount', p_amount, 'requester_username', v_username)
  from (
    select user_id as recipient from public.casino_members
    where casino_id = p_casino_id and role = 'admin' and user_id <> auth.uid()
    union
    select owner_id from public.casinos
    where id = p_casino_id and owner_id <> auth.uid()
  ) recipients;

  return v_request;
end;
$$;

create or replace function public.cancel_chip_request(p_request_id uuid)
returns void language plpgsql security definer as $$
begin
  update public.chip_requests
  set status = 'denied', resolved_by = auth.uid(), resolved_at = now()
  where id = p_request_id and user_id = auth.uid() and status = 'pending';

  if not found then
    raise exception 'No pending request to cancel';
  end if;
  -- No notification: the requester is the one acting, they don't need to be
  -- told about their own cancellation.
end;
$$;

create or replace function public.accept_chip_request(p_request_id uuid)
returns void language plpgsql security definer as $$
declare
  v_req public.chip_requests;
  v_new_balance numeric(14,2);
begin
  select * into v_req from public.chip_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_req.status <> 'pending' then raise exception 'Request already resolved'; end if;

  if not public.is_casino_owner_or_admin(v_req.casino_id) then
    raise exception 'Only the casino creator or an admin can resolve chip requests';
  end if;

  update public.casino_members
  set balance = balance + v_req.amount
  where casino_id = v_req.casino_id and user_id = v_req.user_id
  returning balance into v_new_balance;
  if not found then raise exception 'Member not found'; end if;

  insert into public.transactions (casino_id, user_id, admin_id, amount, balance_after, description)
  values (v_req.casino_id, v_req.user_id, auth.uid(), v_req.amount, v_new_balance, 'Chip request');

  update public.chip_requests
  set status = 'accepted', resolved_by = auth.uid(), resolved_at = now()
  where id = p_request_id;

  insert into public.notifications (casino_id, user_id, type, payload)
  values (v_req.casino_id, v_req.user_id, 'chip_request_accepted',
          jsonb_build_object('request_id', p_request_id, 'amount', v_req.amount));
end;
$$;

create or replace function public.deny_chip_request(p_request_id uuid)
returns void language plpgsql security definer as $$
declare
  v_req public.chip_requests;
begin
  select * into v_req from public.chip_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_req.status <> 'pending' then raise exception 'Request already resolved'; end if;

  if not public.is_casino_owner_or_admin(v_req.casino_id) then
    raise exception 'Only the casino creator or an admin can resolve chip requests';
  end if;

  update public.chip_requests
  set status = 'denied', resolved_by = auth.uid(), resolved_at = now()
  where id = p_request_id;

  insert into public.notifications (casino_id, user_id, type, payload)
  values (v_req.casino_id, v_req.user_id, 'chip_request_denied',
          jsonb_build_object('request_id', p_request_id, 'amount', v_req.amount));
end;
$$;

-- Pending requests only: admin/owner see every pending request in the
-- casino; a plain member sees only their own (0 or 1, given the unique
-- partial index). Deliberately not reusing is_casino_agent's downline
-- scoping from list_chip_transactions — an agent isn't an admin and can't
-- resolve requests, so they see nothing here (same as a plain member with
-- no pending request of their own).
create or replace function public.list_chip_requests(p_casino_id uuid)
returns table (
  id uuid,
  user_id uuid,
  username text,
  amount numeric(14,2),
  created_at timestamptz
) language plpgsql security definer as $$
begin
  return query
  select r.id, r.user_id, p.username, r.amount, r.created_at
  from public.chip_requests r
  join public.profiles p on p.id = r.user_id
  where r.casino_id = p_casino_id
    and r.status = 'pending'
    and (public.is_casino_owner_or_admin(p_casino_id) or r.user_id = auth.uid())
  order by r.created_at asc;
end;
$$;

create or replace function public.list_notifications(p_casino_id uuid)
returns table (
  id uuid,
  type text,
  payload jsonb,
  read_at timestamptz,
  created_at timestamptz
) language plpgsql security definer as $$
begin
  return query
  select n.id, n.type, n.payload, n.read_at, n.created_at
  from public.notifications n
  where n.casino_id = p_casino_id and n.user_id = auth.uid()
  order by n.created_at desc
  limit 50;
end;
$$;

create or replace function public.mark_notifications_read(p_casino_id uuid)
returns void language plpgsql security definer as $$
begin
  update public.notifications
  set read_at = now()
  where casino_id = p_casino_id and user_id = auth.uid() and read_at is null;
end;
$$;
```

`accept_chip_request` deliberately mirrors `give_chips`'s balance-update +
`transactions` insert shape (description `'Chip request'` instead of
`'Admin chip grant'`) rather than calling `give_chips` itself, since
`give_chips` re-derives authorization from scratch and this RPC already has
the request row locked (`for update`) — calling out to another
`security definer` function here would just re-run the same checks. The
distinct description value is purely informational; `list_chip_transactions`
already includes it for free since its `where` clause keys off
`admin_id is not null`, not the description text.

## Frontend

### `src/types/index.ts`

```ts
export type ChipRequestStatus = "pending" | "accepted" | "denied";

export interface ChipRequest {
  id: string;
  user_id: string;
  username: string | null;
  amount: number;
  created_at: string;
}

export type NotificationType = "chip_request_created" | "chip_request_accepted" | "chip_request_denied";

export interface AppNotification {
  id: string;
  type: NotificationType;
  payload: { request_id: string; amount: number; requester_username?: string };
  read_at: string | null;
  created_at: string;
}
```

### `src/hooks/useChipRequests.ts` (new)

`requestChips(casinoId, amount)`, `cancelChipRequest(requestId)`,
`acceptChipRequest(requestId)`, `denyChipRequest(requestId)`,
`listChipRequests(casinoId): Promise<ChipRequest[]>` — same throw-on-error
pattern as `useCasino.ts`. `requestChips` catches a unique-violation
(Postgres code `23505`) and rethrows a friendly
`"You already have a pending request"` Error, so the popup doesn't have to
know about Postgres error codes.

### `src/hooks/useNotifications.ts` (new)

`listNotifications(casinoId): Promise<AppNotification[]>`,
`markNotificationsRead(casinoId)`.

### `GetChipsModal` (new, `src/components/lobby/GetChipsModal.tsx`)

Opened from the "Get chips" button in `LobbyTopBar.tsx`. On open, fetches
the caller's own pending request via `listChipRequests` (filtering to
`user_id === self`, or a tiny `hasPending` shortcut — decided during
implementation). Two states:
- **No pending request**: amount input + Submit, mirroring
  `MemberPopup`'s chip-amount field. Calls `requestChips`, then closes.
- **Pending request exists**: shows the amount and a Cancel button
  (`cancelChipRequest`), no form.

### Trades page (`ChipLedgerPanel.tsx`)

Gains a `canManage: boolean` prop (owner/admin only — narrower than the
existing `showUserColumn`, which also includes agents) and a "Pending
requests" section rendered above the existing period filter + ledger table:
- **Admin/owner**: every pending request (username, amount, requested-at)
  with Accept/Deny buttons. Accepting or denying refetches both the pending
  list and (on accept) the ledger, since a new transaction just landed.
- **Plain member**: their own pending request, if any, with a Cancel button
  (same action `GetChipsModal` offers — surfacing it here too means they
  don't have to reopen the popup to cancel).
- **Agent**: nothing new here — agents can view but not manage, matching
  `list_chip_requests`' scoping.

Empty state (no pending requests visible to the caller): the section is
omitted entirely rather than showing an empty box, so a casino with no
outstanding requests looks exactly like it does today.

### Notification bell (`LobbyTopBar.tsx`)

The bell button becomes a popover trigger (small `Modal size="sm"`-style
panel, anchored under the bell) listing notifications newest-first, each
rendered from `type`:
- `chip_request_created` → *"{requester_username} requested {amount} chips"*
  (admin-facing)
- `chip_request_accepted` → *"Your request for {amount} chips was accepted"*
- `chip_request_denied` → *"Your request for {amount} chips was denied"*

A red dot on the bell shows whenever any fetched notification has
`read_at === null`. Notifications are fetched once when the lobby
(`GamesLobby`) mounts / casino changes — no polling, no realtime
subscription. Opening the popover calls `markNotificationsRead` and
optimistically clears local unread state.

### Wiring (`CasinoDashboard.tsx` / `GamesLobby.tsx`)

Follows the existing modal-state pattern (`activeGame`, `selectedMember`,
`gameModal`): a `getChipsOpen` boolean and a `notificationsOpen` boolean,
threaded down through `GamesLobby` to `LobbyTopBar` the same way `onBack`
and `onCopyCode` already are.

## New / changed files

**New**
- `supabase/migrations/051_chip_requests.sql`
- `src/hooks/useChipRequests.ts`
- `src/hooks/useNotifications.ts`
- `src/components/lobby/GetChipsModal.tsx`
- `src/components/lobby/NotificationsPopover.tsx`

**Changed**
- `src/types/index.ts` — `ChipRequest`, `AppNotification` types.
- `src/components/lobby/LobbyTopBar.tsx` — wire up "Get chips" and bell
  buttons; red-dot indicator.
- `src/components/lobby/GamesLobby.tsx` — own the new modal/popover state,
  fetch notifications on mount.
- `src/components/ChipLedgerPanel.tsx` — pending-requests section +
  `canManage` prop.
- `src/pages/CasinoDashboard.tsx` — pass `canManageMembers` through to
  `ChipLedgerPanel` as `canManage`.

## Testing

- **Manual/integration** (test account, Playwright): as a member, submit a
  chip request, confirm the "Get chips" button opens the pending state
  instead of the form on reopen, and that a second request attempt (e.g.
  via a second tab logged in as the same test admin, who is also a member
  of a casino) is rejected with the friendly message. As admin, confirm the
  pending request appears on the Trades page, Accept applies the exact
  balance change and the row appears in the ledger below, Deny leaves the
  balance untouched. Confirm the bell shows a red dot after a request is
  created (for the admin) and after it's resolved (for the requester), and
  that opening the bell clears it. Confirm Cancel removes a pending request
  without notifying anyone.
- No engine/pure-function logic here worth unit testing — same reasoning as
  the chip-ledger spec: the RPCs are the single source of truth for
  authorization and the one-pending-request constraint, best verified
  against the real database.

## Security notes

- Authorization for accept/deny is re-checked server-side in each RPC via
  `is_casino_owner_or_admin`, not inferred from what the client happened to
  render — a non-admin calling `accept_chip_request` directly gets a raised
  exception, same shape as `give_chips`.
- The one-pending-request-per-member rule is enforced by a partial unique
  index, not just client-side state — concurrent double-submits from two
  tabs can't both succeed.
- `chip_requests` and `notifications` both have RLS enabled with zero
  policies; every access path is a `security definer` RPC. This is a
  slightly stricter shape than `transactions` (which still has direct
  owner-row policies alongside its RPCs) — chosen because nothing in this
  feature needs a direct `.from()` read, so there's no reason to open a
  second access path.
