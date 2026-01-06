-- Supabase SQL schema for “灵感笔记”
-- 1) 在 Supabase Dashboard 打开 SQL Editor
-- 2) 复制粘贴并执行本文件

-- UUID 生成函数（gen_random_uuid）
create extension if not exists pgcrypto;

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,

  title text not null default '',
  content text not null default '',
  tags text[] not null default '{}'::text[],

  pinned boolean not null default false,
  color text not null default '#6C5CE7',
  image text,

  is_public boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notes_owner_id_idx on public.notes(owner_id);
create index if not exists notes_is_public_idx on public.notes(is_public);
create index if not exists notes_updated_at_idx on public.notes(updated_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_notes_updated_at on public.notes;
create trigger set_notes_updated_at
before update on public.notes
for each row
execute function public.set_updated_at();

alter table public.notes enable row level security;

-- 公开笔记：任何人（含未登录）都能读取
drop policy if exists "Public can read public notes" on public.notes;
create policy "Public can read public notes"
on public.notes
for select
to anon, authenticated
using (is_public = true);

-- 私有笔记：仅本人可读
drop policy if exists "Users can read own notes" on public.notes;
create policy "Users can read own notes"
on public.notes
for select
to authenticated
using (owner_id = auth.uid());

-- 仅本人可写（增/改/删）
drop policy if exists "Users can insert own notes" on public.notes;
create policy "Users can insert own notes"
on public.notes
for insert
to authenticated
with check (owner_id = auth.uid());

drop policy if exists "Users can update own notes" on public.notes;
create policy "Users can update own notes"
on public.notes
for update
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists "Users can delete own notes" on public.notes;
create policy "Users can delete own notes"
on public.notes
for delete
to authenticated
using (owner_id = auth.uid());
