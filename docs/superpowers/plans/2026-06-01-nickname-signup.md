# Nickname at Signup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a required, unique nickname field to the signup form that gets stored in `profiles.username` and displayed in the top-right nav.

**Architecture:** The nickname is passed as Supabase auth user metadata at signup time. The `handle_new_user` DB trigger (already in place) is updated to read that metadata instead of deriving a username from the email prefix. The unique constraint on `profiles.username` enforces uniqueness atomically — if it fails, the auth insert rolls back too, leaving no orphaned account.

**Tech Stack:** Supabase (PostgreSQL trigger, auth metadata), React, TypeScript

---

### Task 1: Update the DB trigger to use auth metadata

**Files:**
- Create: `supabase/migrations/007_nickname_trigger.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/007_nickname_trigger.sql` with this content:

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

The trigger registration (`create trigger on_auth_user_created`) is unchanged — only the function body changes.

- [ ] **Step 2: Apply the migration via Supabase MCP**

Use the `mcp__claude_ai_Supabase__apply_migration` tool with:
- `project_id`: `tvivhadsgtvfvxwpahef`
- `name`: `nickname_trigger`
- `query`: (the SQL above)

- [ ] **Step 3: Verify the trigger updated**

Use `mcp__claude_ai_Supabase__execute_sql` with:
```sql
select prosrc from pg_proc where proname = 'handle_new_user';
```
Expected output: the function body contains `raw_user_meta_data->>'nickname'`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/007_nickname_trigger.sql
git commit -m "feat: update handle_new_user trigger to use auth metadata nickname"
```

---

### Task 2: Add nickname field to the signup form

**Files:**
- Modify: `src/pages/Auth.tsx`

- [ ] **Step 1: Add nickname state and update the signUp call**

In `src/pages/Auth.tsx`, make the following changes:

1. Add `nickname` to the state declarations (after the `password` state):
```tsx
const [nickname, setNickname] = useState("");
```

2. Replace the existing `signUp` call inside `handleSubmit`:
```tsx
// Before:
const { error } = await supabase.auth.signUp({ email, password });

// After:
const { error } = await supabase.auth.signUp({
  email,
  password,
  options: { data: { nickname: nickname.trim() } },
});
```

3. Add duplicate-nickname error mapping — replace the `if (error) throw error;` line that follows signUp with:
```tsx
if (error) {
  const msg = error.message.toLowerCase();
  if (
    msg.includes("profiles_username_key") ||
    msg.includes("duplicate key") ||
    msg.includes("already taken") ||
    msg.includes("database error saving new user")
  ) {
    throw new Error("That nickname is already taken.");
  }
  throw error;
}
```

> **Note:** Supabase GoTrue sometimes returns a generic "Database error saving new user" for trigger failures. The broad `||` chain above catches the known variants. During manual testing (Step 4), open the browser console to confirm which message is actually returned — adjust the condition if needed.

- [ ] **Step 2: Add the nickname input to the form**

Inside the `<form>` in the JSX, add this block between the email `<div>` and the password `<div>`, rendering only in signup mode:

```tsx
{mode === "signup" && (
  <div>
    <Label htmlFor="nickname">Nickname</Label>
    <Input
      id="nickname"
      type="text"
      value={nickname}
      onChange={(e) => setNickname(e.target.value)}
      required
    />
  </div>
)}
```

- [ ] **Step 3: Reset nickname when switching modes**

Update the mode-toggle button's `onClick` so nickname is cleared when switching back to sign-in (prevents stale state leaking into sign-in submissions):

```tsx
onClick={() => {
  setMode((m) => (m === "signin" ? "signup" : "signin"));
  setNickname("");
  setError(null);
}}
```

- [ ] **Step 4: Start the dev server and manually verify**

```bash
npm run dev
```

Open http://localhost:5173/auth and verify:

- **Signup path:** Nickname field appears between email and password. Submitting with a blank nickname is blocked by browser validation. Signing up with a fresh nickname succeeds and the nickname appears in the top-right nav. Signing up again with the same nickname shows "That nickname is already taken."
- **Sign-in path:** No nickname field visible. Existing sign-in flow is unaffected.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Auth.tsx
git commit -m "feat: add required nickname field to signup form"
```
