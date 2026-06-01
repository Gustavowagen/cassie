# Nickname at Signup — Design Spec

**Date:** 2026-06-01

## Overview

Add a required, unique nickname field to the signup flow. The nickname is stored in `profiles.username` and displayed in the top-right nav when the user is signed in.

## Data Layer

No new columns. The existing `profiles.username` column (`TEXT UNIQUE NOT NULL`) serves as the nickname store.

**Migration:** Update the `handle_new_user` trigger to read the nickname from Supabase auth user metadata (`new.raw_user_meta_data->>'nickname'`) instead of deriving it from the email prefix.

```sql
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username)
  values (new.id, new.raw_user_meta_data->>'nickname');
  return new;
end;
$$;
```

If the nickname is already taken, the unique constraint causes the trigger to fail, which rolls back the entire `auth.users` insert — no orphaned accounts.

## Signup Form (`src/pages/Auth.tsx`)

- Add a `nickname` state field (string, trimmed before use).
- Show a "Nickname" input only when `mode === "signup"`, placed between the email and password fields.
- The field is `required`.
- Pass `options: { data: { nickname: nickname.trim() } }` to `supabase.auth.signUp(...)`.
- Errors (including duplicate nickname constraint violations) are surfaced via the existing `error` state display.
- Sign-in form is unchanged.

## Display (`src/components/Layout.tsx`)

No changes required. `Layout` already reads `profile?.username ?? user?.email` for the display name. Once the profile is created with the user-chosen nickname, it renders correctly.

## Types (`src/types/index.ts`)

No changes required. The `Profile` interface already has `username: string`.

## Error Handling

| Scenario | Behaviour |
|---|---|
| Nickname already taken | Supabase returns a DB error from the trigger; the signup handler detects `profiles_username_key` in the error message and shows "That nickname is already taken." |
| Nickname field left empty | Browser native `required` validation prevents submit |
| Sign-in (no nickname field) | Nickname input not rendered; no change to sign-in path |

## Out of Scope

- Allowing users to change their nickname after signup
- Nickname format validation (length limits, character restrictions)
- Case-insensitive uniqueness enforcement
