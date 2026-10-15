-- Run in the Supabase SQL editor. Enable Authentication > Providers > Anonymous Sign-ins.
-- This starter treats anyone holding a trip invite as a member/editor; don't use for sensitive data.
create extension if not exists pgcrypto;
create table if not exists public.trips (
 id uuid primary key default gen_random_uuid(),
 invite uuid not null default gen_random_uuid(),
 owner_id uuid not null references auth.users(id),
 state jsonb not null,
 version bigint not null default 1,
 updated_at timestamptz not null default now()
);
create table if not exists public.trip_members (
 trip_id uuid not null references public.trips(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 joined_at timestamptz not null default now(),
 primary key(trip_id,user_id)
);
create index if not exists trip_members_user_idx on public.trip_members(user_id);
alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
drop policy if exists "members can view trips" on public.trips;
create policy "members can view trips" on public.trips for select to authenticated using (
 exists (select 1 from public.trip_members m where m.trip_id=id and m.user_id=(select auth.uid()))
);
drop policy if exists "members can view own memberships" on public.trip_members;
create policy "members can view own memberships" on public.trip_members for select to authenticated using(user_id=(select auth.uid()));

create or replace function public.create_trip(p_state jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.trips;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 if p_state is null or jsonb_typeof(p_state) <> 'object' or pg_column_size(p_state)>2000000 then raise exception 'Invalid trip data'; end if;
 insert into public.trips(owner_id,state) values(auth.uid(),p_state) returning * into t;
 insert into public.trip_members(trip_id,user_id) values(t.id,auth.uid());
 return jsonb_build_object('id',t.id,'invite',t.invite,'version',t.version,'state',t.state);
end $$;
create or replace function public.join_trip(p_trip_id uuid,p_invite uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.trips;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 select * into t from public.trips where id=p_trip_id and invite=p_invite;
 if not found then raise exception 'Invalid or revoked invitation'; end if;
 insert into public.trip_members(trip_id,user_id) values(t.id,auth.uid()) on conflict do nothing;
 return jsonb_build_object('id',t.id,'version',t.version,'state',t.state);
end $$;
create or replace function public.save_trip_state(p_trip_id uuid,p_state jsonb,p_expected_version bigint)
returns bigint language plpgsql security definer set search_path=public,pg_temp as $$
declare v bigint;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 if p_state is null or jsonb_typeof(p_state) <> 'object' or pg_column_size(p_state)>2000000 then raise exception 'Invalid trip data'; end if;
 if not exists(select 1 from public.trip_members where trip_id=p_trip_id and user_id=auth.uid()) then raise exception 'Not a trip member'; end if;
 update public.trips set state=p_state,version=version+1,updated_at=now()
 where id=p_trip_id and version=p_expected_version returning version into v;
 if v is null then raise exception 'Trip changed on another device; refresh before retrying'; end if;
 return v;
end $$;
revoke execute on function public.create_trip(jsonb) from public,anon;
revoke execute on function public.join_trip(uuid,uuid) from public,anon;
revoke execute on function public.save_trip_state(uuid,jsonb,bigint) from public,anon;
grant execute on function public.create_trip(jsonb) to authenticated;
grant execute on function public.join_trip(uuid,uuid) to authenticated;
grant execute on function public.save_trip_state(uuid,jsonb,bigint) to authenticated;
grant select on public.trips to authenticated;
grant select on public.trip_members to authenticated;
-- If the table is not already in the publication, run this once to enable live updates:
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='trips') then
  alter publication supabase_realtime add table public.trips;
 end if;
end $$;
