-- HandyHub: roles, referrals, worker verification schema.
-- Run once via psql (or the Supabase SQL editor) against the project's database.
-- Safe to re-run: every statement is idempotent.

-- 1. Role enum
do $$
begin
  create type public.user_role as enum ('customer', 'worker', 'agent');
exception
  when duplicate_object then null;
end $$;

-- 2. Profiles table
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.user_role not null default 'customer',
  name text not null,
  email text,
  phone text,
  location text,
  skills text[] not null default '{}',
  id_type text,
  id_number text,
  id_document_path text,
  id_verification_status text not null default 'unverified'
    check (id_verification_status in ('unverified', 'pending', 'verified', 'rejected')),
  referral_code text unique,
  recruited_by uuid references public.profiles(id),
  agent_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_recruited_by_idx on public.profiles (recruited_by);
create index if not exists profiles_referral_code_idx on public.profiles (referral_code);

-- 3. Keep updated_at current
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- 4. Auto-create a profile row for every new auth user, seeded from the
--    metadata passed at signUp/signInWithOtp (options.data). Resolves a
--    referral code entered at sign-up to the recruiting agent's id.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recruiter_id uuid;
  v_referral_code text;
begin
  v_referral_code := new.raw_user_meta_data ->> 'referral_code_entered';
  if v_referral_code is not null then
    select id into v_recruiter_id
    from public.profiles
    where referral_code = v_referral_code and role = 'agent';
  end if;

  insert into public.profiles (
    id, role, name, email, phone, location, skills, id_type, id_number, recruited_by
  )
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'role', ''), 'customer')::public.user_role,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'name', ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'HandyHub user'
    ),
    new.email,
    new.phone,
    new.raw_user_meta_data ->> 'location',
    case
      when new.raw_user_meta_data ? 'skills' then (
        select coalesce(array_agg(value), '{}')
        from jsonb_array_elements_text(new.raw_user_meta_data -> 'skills') as value
      )
      else '{}'
    end,
    new.raw_user_meta_data ->> 'id_type',
    new.raw_user_meta_data ->> 'id_number',
    v_recruiter_id
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create or replace trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- 5. Re-sync profile fields whenever auth metadata changes. This is what keeps
--    Google sign-up in sync: OAuth accounts can't carry custom metadata through
--    the initial insert, so the app attaches role/skills/location afterwards via
--    supabase.auth.updateUser(), which fires this trigger.
create or replace function public.handle_user_metadata_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referral_code text;
  v_recruiter_id uuid;
begin
  update public.profiles
  set
    role = coalesce(nullif(new.raw_user_meta_data ->> 'role', ''), role::text)::public.user_role,
    name = coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), name),
    location = coalesce(new.raw_user_meta_data ->> 'location', location),
    skills = case
      when new.raw_user_meta_data ? 'skills' then (
        select coalesce(array_agg(value), '{}')
        from jsonb_array_elements_text(new.raw_user_meta_data -> 'skills') as value
      )
      else skills
    end,
    id_type = coalesce(new.raw_user_meta_data ->> 'id_type', id_type),
    id_number = coalesce(new.raw_user_meta_data ->> 'id_number', id_number)
  where id = new.id;

  -- Google sign-up can't pass metadata through the initial insert (the OAuth
  -- callback creates the row before the app can attach a referral code), so
  -- resolve it here instead. Only ever sets recruited_by once.
  v_referral_code := new.raw_user_meta_data ->> 'referral_code_entered';
  if v_referral_code is not null then
    select id into v_recruiter_id
    from public.profiles
    where referral_code = v_referral_code and role = 'agent';

    if v_recruiter_id is not null then
      update public.profiles
      set recruited_by = v_recruiter_id
      where id = new.id and recruited_by is null;
    end if;
  end if;

  return new;
end;
$$;

create or replace trigger on_auth_user_metadata_updated
after update of raw_user_meta_data on auth.users
for each row execute function public.handle_user_metadata_update();

-- 6. Row-level security
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles_select_recruits" on public.profiles;
create policy "profiles_select_recruits"
  on public.profiles for select
  using (recruited_by = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- 7. Column-level grants: authenticated users can never touch role,
--    referral_code, recruited_by or agent_active directly. Those are only
--    ever set by the security-definer trigger above, or by an operator
--    running SQL by hand (see the bottom of this file).
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (
  name, phone, location, skills, id_type, id_number, id_document_path, id_verification_status
) on public.profiles to authenticated;

-- 8. Storage bucket for ID document photos
insert into storage.buckets (id, name, public)
values ('id-documents', 'id-documents', false)
on conflict (id) do nothing;

drop policy if exists "id_documents_insert_own" on storage.objects;
create policy "id_documents_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'id-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "id_documents_select_own" on storage.objects;
create policy "id_documents_select_own"
  on storage.objects for select
  using (
    bucket_id = 'id-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "id_documents_update_own" on storage.objects;
create policy "id_documents_update_own"
  on storage.objects for update
  using (
    bucket_id = 'id-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 9. Jobs: a customer posts a job (optionally with an opening offer), any
--    worker whose skills cover the category can pick it up, and the two
--    sides go back and forth on price before one of them accepts.
do $$
begin
  create type public.job_status as enum ('open', 'negotiating', 'accepted', 'in_progress', 'completed', 'cancelled');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.job_pay_type as enum ('hourly', 'task');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.job_offer_by as enum ('customer', 'worker');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  worker_id uuid references public.profiles(id) on delete set null,
  category text not null,
  service text not null,
  pay_type public.job_pay_type not null default 'task',
  location text,
  listed_price numeric,
  current_offer numeric,
  offer_by public.job_offer_by,
  final_price numeric,
  status public.job_status not null default 'open',
  completion_code text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists jobs_customer_id_idx on public.jobs (customer_id);
create index if not exists jobs_worker_id_idx on public.jobs (worker_id);
create index if not exists jobs_category_idx on public.jobs (category);

create or replace trigger jobs_set_updated_at
before update on public.jobs
for each row execute function public.set_updated_at();

-- Auto-issue a 4-digit completion code the moment a job is accepted, so the
-- customer has something to hand the worker in person once the job is done.
create or replace function public.jobs_generate_completion_code()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'accepted' and old.status is distinct from 'accepted' and new.completion_code is null then
    new.completion_code := lpad(floor(random() * 10000)::int::text, 4, '0');
  end if;
  return new;
end;
$$;

create or replace trigger jobs_generate_completion_code
before update on public.jobs
for each row execute function public.jobs_generate_completion_code();

alter table public.jobs enable row level security;

-- Either side of a job (once matched) can read it.
drop policy if exists "jobs_select_participant" on public.jobs;
create policy "jobs_select_participant"
  on public.jobs for select
  using (customer_id = auth.uid() or worker_id = auth.uid());

-- Any worker whose skills include the job's category can see unclaimed jobs.
drop policy if exists "jobs_select_open_for_matching_workers" on public.jobs;
create policy "jobs_select_open_for_matching_workers"
  on public.jobs for select
  using (
    status = 'open'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'worker' and jobs.category = any(p.skills)
    )
  );

drop policy if exists "jobs_insert_customer" on public.jobs;
create policy "jobs_insert_customer"
  on public.jobs for insert
  with check (customer_id = auth.uid());

-- Once matched, either participant can update it (negotiate, accept, etc).
drop policy if exists "jobs_update_participant" on public.jobs;
create policy "jobs_update_participant"
  on public.jobs for update
  using (customer_id = auth.uid() or worker_id = auth.uid())
  with check (customer_id = auth.uid() or worker_id = auth.uid());

-- A matching worker can claim (or make an opening counter-offer on) an
-- open, unclaimed job by setting themselves as worker_id.
drop policy if exists "jobs_update_claim_open" on public.jobs;
create policy "jobs_update_claim_open"
  on public.jobs for update
  using (
    status = 'open'
    and worker_id is null
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'worker' and jobs.category = any(p.skills)
    )
  )
  with check (worker_id = auth.uid());

revoke all on public.jobs from anon, authenticated;
grant select, insert on public.jobs to authenticated;
grant update (
  worker_id, current_offer, offer_by, final_price, status, completed_at
) on public.jobs to authenticated;

-- Completion codes are verified server-side via this function rather than
-- column grants, so a worker's client never needs to read the stored code —
-- they only ever submit what the customer told them, in person. Also
-- requires payment_method to be set (added in section 18) — a job can't be
-- completed until the customer has recorded how they paid.
create or replace function public.complete_job(job_id uuid, code text)
returns public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs;
begin
  select * into v_job from public.jobs where id = job_id;
  if v_job.id is null then
    raise exception 'Job not found';
  end if;
  if v_job.worker_id is distinct from auth.uid() then
    raise exception 'Not your job';
  end if;
  if v_job.status is distinct from 'in_progress' then
    raise exception 'Job is not in progress';
  end if;
  if v_job.payment_method is null then
    raise exception 'The customer hasn''t recorded payment for this job yet';
  end if;
  if v_job.completion_code is distinct from code then
    raise exception 'Incorrect completion code';
  end if;

  update public.jobs
  set status = 'completed', completed_at = now()
  where id = job_id
  returning * into v_job;

  return v_job;
end;
$$;

grant execute on function public.complete_job(uuid, text) to authenticated;

-- 10. Test data — a handful of jobs across every status, wired to whatever
--     customer/worker accounts already exist, so the negotiation and
--     completion-code flows have something real to exercise. Idempotent:
--     each insert is guarded so re-running this file won't duplicate rows.
do $$
declare
  v_customer_id uuid;
  v_worker_id uuid;
begin
  select id into v_customer_id from public.profiles where role = 'customer' order by created_at limit 1;
  select id into v_worker_id from public.profiles where role = 'worker' order by created_at limit 1;

  if v_customer_id is null or v_worker_id is null then
    raise notice 'Skipping job seed data: need at least one customer and one worker profile.';
    return;
  end if;

  -- Open job, unclaimed, in the seeded worker's skills — should show up in their Jobs tab.
  insert into public.jobs (customer_id, worker_id, category, service, pay_type, location, listed_price, current_offer, offer_by, status)
  select v_customer_id, null, 'Plumbing', 'Leaking tap repair', 'task', 'Westlands', 1200, 1200, 'customer', 'open'
  where not exists (
    select 1 from public.jobs where customer_id = v_customer_id and service = 'Leaking tap repair'
  );

  -- Open job outside the seeded worker's skills — should NOT show up for them.
  insert into public.jobs (customer_id, worker_id, category, service, pay_type, location, listed_price, current_offer, offer_by, status)
  select v_customer_id, null, 'Painting', 'Fence painting', 'task', 'Karen', 3000, 3000, 'customer', 'open'
  where not exists (
    select 1 from public.jobs where customer_id = v_customer_id and service = 'Fence painting'
  );

  -- Negotiating: worker claimed it and countered; customer's turn to respond.
  insert into public.jobs (customer_id, worker_id, category, service, pay_type, location, listed_price, current_offer, offer_by, status)
  select v_customer_id, v_worker_id, 'Electrical', 'Socket rewiring', 'task', 'Kilimani', 2000, 1700, 'worker', 'negotiating'
  where not exists (
    select 1 from public.jobs where customer_id = v_customer_id and service = 'Socket rewiring'
  );

  -- Accepted & in progress: price is final, completion code already issued.
  insert into public.jobs (customer_id, worker_id, category, service, pay_type, location, current_offer, offer_by, final_price, status, completion_code)
  select v_customer_id, v_worker_id, 'Carpentry', 'Wardrobe repair', 'task', 'Lavington', 1500, 'worker', 1500, 'in_progress', '4821'
  where not exists (
    select 1 from public.jobs where customer_id = v_customer_id and service = 'Wardrobe repair'
  );

  -- Completed, for the history views.
  insert into public.jobs (customer_id, worker_id, category, service, pay_type, location, current_offer, offer_by, final_price, status, completed_at)
  select v_customer_id, v_worker_id, 'Plumbing', 'Kitchen sink installation', 'hourly', 'Westlands', 1800, 'worker', 1800, 'completed', now() - interval '2 days'
  where not exists (
    select 1 from public.jobs where customer_id = v_customer_id and service = 'Kitchen sink installation'
  );
end $$;

-- 11. Auto-generate a unique referral code for every agent, so an operator
--     never has to invent one by hand. Format: AGENTHB_<name>_<4 random digits>,
--     e.g. AGENTHB_benbasil_4821. Fires whenever a row's role is (or becomes)
--     'agent' and it doesn't already have a code.
create or replace function public.generate_agent_referral_code(p_name text)
returns text
language plpgsql
as $$
declare
  v_base text;
  v_code text;
begin
  v_base := regexp_replace(lower(coalesce(nullif(trim(p_name), ''), 'agent')), '[^a-z0-9]+', '', 'g');
  if v_base = '' then
    v_base := 'agent';
  end if;

  loop
    v_code := 'AGENTHB_' || v_base || '_' || lpad(floor(random() * 10000)::int::text, 4, '0');
    exit when not exists (select 1 from public.profiles where referral_code = v_code);
  end loop;

  return v_code;
end;
$$;

create or replace function public.set_agent_referral_code()
returns trigger
language plpgsql
as $$
begin
  if new.role = 'agent' and new.referral_code is null then
    new.referral_code := public.generate_agent_referral_code(new.name);
  end if;
  return new;
end;
$$;

create or replace trigger profiles_set_agent_referral_code
before insert or update on public.profiles
for each row execute function public.set_agent_referral_code();

-- 12. Public worker directory. Customers need to browse real workers to book
--     them, but the base profiles RLS only lets you read your own row (or
--     your recruits'). Rather than opening up SELECT on the whole profiles
--     table, this security-definer function hands back only the columns
--     that are safe to show any signed-in customer — including an average
--     rating computed here so browsing customers never need direct SELECT
--     on other people's job rows (RLS would only show them their own jobs
--     anyway; this aggregate is the safe, public-facing view of it).
drop function if exists public.list_available_workers();
create function public.list_available_workers()
returns table (
  id uuid, name text, location text, skills text[], id_verification_status text,
  rating_average numeric, rating_count int
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id, p.name, p.location, p.skills, p.id_verification_status,
    coalesce(round(avg(j.rating), 2), 0) as rating_average,
    count(j.rating)::int as rating_count
  from public.profiles p
  left join public.jobs j on j.worker_id = p.id and j.rating is not null
  where p.role = 'worker'
  group by p.id, p.name, p.location, p.skills, p.id_verification_status;
$$;

grant execute on function public.list_available_workers() to authenticated;

-- 13. Notifications: worker gets pinged when a job matching their skills
--     shows up (whether posted directly to them or still unclaimed);
--     whichever side didn't just move gets pinged when the price changes,
--     and both sides get pinged when a job is accepted or completed.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  kind text not null check (kind in ('new_job', 'price_changed', 'job_accepted', 'job_completed', 'schedule_changed', 'job_rated')),
  title text not null,
  body text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_id_created_at_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own"
  on public.notifications for select
  using (user_id = auth.uid());

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own"
  on public.notifications for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- No insert/delete grants for authenticated — only the security-definer
-- trigger functions below ever create notification rows.
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read) on public.notifications to authenticated;

create or replace function public.jobs_notify_new()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.worker_id is not null then
    insert into public.notifications (user_id, job_id, kind, title, body)
    values (
      new.worker_id, new.id, 'new_job', 'New job request',
      new.service || ' — KSh ' || coalesce(new.current_offer::text, new.listed_price::text, '?')
    );
  else
    insert into public.notifications (user_id, job_id, kind, title, body)
    select
      p.id, new.id, 'new_job', 'New job matching your skills',
      new.service || ' — KSh ' || coalesce(new.current_offer::text, new.listed_price::text, '?')
    from public.profiles p
    where p.role = 'worker' and new.category = any(p.skills);
  end if;
  return new;
end;
$$;

create or replace trigger jobs_notify_new_trigger
after insert on public.jobs
for each row execute function public.jobs_notify_new();

-- jobs_notify_update() and its trigger are defined once, in section 16 below
-- (it also handles reschedule-proposed and job-rated notifications).

-- 14. Let either side edit a job's description/location up until a price is
--     agreed — after that the details are locked, enforced here (not just in
--     the client) so a stale screen can't sneak an edit past acceptance.
--     The service description and category are never editable by either
--     side (changing them after a worker matched on them would be
--     misleading) — only location and the scheduled date/time are.
alter table public.jobs add column if not exists scheduled_at timestamptz;

revoke update (service) on public.jobs from authenticated;
grant update (location, scheduled_at) on public.jobs to authenticated;

create or replace function public.jobs_lock_details_after_agreement()
returns trigger
language plpgsql
as $$
begin
  if old.status not in ('open', 'negotiating') and new.location is distinct from old.location then
    raise exception 'Location can only be edited before the price is agreed.';
  end if;
  -- Unlike location, the scheduled time may still shift after a price is
  -- agreed (see section 16) — it's only locked once the job is over.
  if old.status in ('completed', 'cancelled') and new.scheduled_at is distinct from old.scheduled_at then
    raise exception 'A completed or cancelled job can no longer be rescheduled.';
  end if;
  return new;
end;
$$;

create or replace trigger jobs_lock_details_after_agreement
before update on public.jobs
for each row execute function public.jobs_lock_details_after_agreement();

-- 15. Once a job is matched (worker_id set), each side can look up the
--     other's phone number to coordinate — but only for that job, and only
--     the number, never the rest of either profile.
create or replace function public.get_job_counterpart_phone(p_job_id uuid)
returns text
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_job public.jobs;
  v_phone text;
begin
  select * into v_job from public.jobs where id = p_job_id;
  if v_job.id is null then
    return null;
  end if;

  if v_job.customer_id = auth.uid() and v_job.worker_id is not null then
    select phone into v_phone from public.profiles where id = v_job.worker_id;
  elsif v_job.worker_id = auth.uid() then
    select phone into v_phone from public.profiles where id = v_job.customer_id;
  else
    return null;
  end if;

  return v_phone;
end;
$$;

grant execute on function public.get_job_counterpart_phone(uuid) to authenticated;

-- Widen the notifications kind check for the two new kinds section 16 adds
-- (the table already existed, so the inline check above never re-applies).
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('new_job', 'price_changed', 'job_accepted', 'job_completed', 'schedule_changed', 'job_rated'));

-- 16. Rescheduling an active job, and rating a completed one.
-- Whoever changes the time is recorded; a change by the worker needs the
-- customer to confirm (mirrors offer_by/current_offer for price), a change
-- by the customer is self-confirmed.
alter table public.jobs add column if not exists schedule_set_by public.job_offer_by;
alter table public.jobs add column if not exists schedule_confirmed boolean not null default true;
alter table public.jobs add column if not exists rating smallint check (rating between 1 and 5);

grant update (schedule_confirmed, rating) on public.jobs to authenticated;

create or replace function public.jobs_track_schedule_change()
returns trigger
language plpgsql
as $$
begin
  if new.scheduled_at is distinct from old.scheduled_at then
    if auth.uid() = old.worker_id then
      new.schedule_set_by := 'worker';
      new.schedule_confirmed := false;
    elsif auth.uid() = old.customer_id then
      new.schedule_set_by := 'customer';
      new.schedule_confirmed := true;
    end if;
  end if;
  return new;
end;
$$;

create or replace trigger jobs_track_schedule_change_trigger
before update on public.jobs
for each row execute function public.jobs_track_schedule_change();

-- A rating can only ever be set once, by the customer, on a job that's done.
create or replace function public.jobs_lock_rating()
returns trigger
language plpgsql
as $$
begin
  if new.rating is distinct from old.rating then
    if auth.uid() is distinct from old.customer_id then
      raise exception 'Only the customer can rate this job.';
    end if;
    if old.status is distinct from 'completed' then
      raise exception 'You can only rate a completed job.';
    end if;
    if old.rating is not null then
      raise exception 'This job has already been rated.';
    end if;
  end if;
  return new;
end;
$$;

create or replace trigger jobs_lock_rating_trigger
before update on public.jobs
for each row execute function public.jobs_lock_rating();

-- Extend the notify-on-update trigger: the customer gets pinged when the
-- worker proposes a new time, and the worker gets pinged when they're rated.
create or replace function public.jobs_notify_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.current_offer is distinct from old.current_offer and new.status = 'negotiating' then
    if new.offer_by = 'worker' then
      insert into public.notifications (user_id, job_id, kind, title, body)
      values (new.customer_id, new.id, 'price_changed', 'New offer on ' || new.service, 'Countered at KSh ' || new.current_offer);
    elsif new.offer_by = 'customer' and new.worker_id is not null then
      insert into public.notifications (user_id, job_id, kind, title, body)
      values (new.worker_id, new.id, 'price_changed', 'New offer on ' || new.service, 'Countered at KSh ' || new.current_offer);
    end if;
  end if;

  if new.status = 'accepted' and old.status is distinct from 'accepted' then
    insert into public.notifications (user_id, job_id, kind, title, body)
    values (new.customer_id, new.id, 'job_accepted', 'Job accepted', new.service || ' agreed at KSh ' || coalesce(new.final_price::text, new.current_offer::text, '?'));
    if new.worker_id is not null then
      insert into public.notifications (user_id, job_id, kind, title, body)
      values (new.worker_id, new.id, 'job_accepted', 'Job accepted', new.service || ' agreed at KSh ' || coalesce(new.final_price::text, new.current_offer::text, '?'));
    end if;
  end if;

  if new.status = 'completed' and old.status is distinct from 'completed' then
    insert into public.notifications (user_id, job_id, kind, title, body)
    values (new.customer_id, new.id, 'job_completed', 'Job completed', new.service || ' is marked done.');
    if new.worker_id is not null then
      insert into public.notifications (user_id, job_id, kind, title, body)
      values (new.worker_id, new.id, 'job_completed', 'Job completed', new.service || ' is marked done.');
    end if;
  end if;

  if new.schedule_set_by = 'worker' and new.schedule_confirmed = false
     and (old.schedule_confirmed is distinct from false or old.scheduled_at is distinct from new.scheduled_at) then
    insert into public.notifications (user_id, job_id, kind, title, body)
    values (new.customer_id, new.id, 'schedule_changed', 'New time proposed on ' || new.service, 'Confirm the new time in your app.');
  end if;

  if new.rating is distinct from old.rating and new.rating is not null and new.worker_id is not null then
    insert into public.notifications (user_id, job_id, kind, title, body)
    values (new.worker_id, new.id, 'job_rated', 'You were rated', new.service || ': ' || new.rating || ' star' || (case when new.rating = 1 then '' else 's' end));
  end if;

  return new;
end;
$$;

create or replace trigger jobs_notify_update_trigger
after update on public.jobs
for each row execute function public.jobs_notify_update();

-- 17. Platform commission: HandyHub takes 10% of a job's final price the
--     moment it completes (worker-side only — customers aren't charged
--     extra for this). Stored on the job itself rather than recomputed, so
--     it stays a stable historical record even if the rate changes later.
alter table public.jobs add column if not exists commission numeric;
alter table public.jobs add column if not exists remitted boolean not null default false;
alter table public.jobs add column if not exists remitted_at timestamptz;

create or replace function public.jobs_set_commission()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' and new.final_price is not null then
    new.commission := round(new.final_price * 0.10, 2);
    -- Paid through the app -> HandyHub already handled the split, so the
    -- commission is auto-remitted. Paid directly to the worker (cash/mobile
    -- money outside the app) -> it stays owed until the worker remits it
    -- manually (see section 18).
    if new.payment_method = 'in_app' then
      new.remitted := true;
      new.remitted_at := now();
    end if;
  end if;
  return new;
end;
$$;

create or replace trigger jobs_set_commission_trigger
before update on public.jobs
for each row execute function public.jobs_set_commission();

-- The worker marks their own completed job's commission as remitted (paid
-- to HandyHub) — once, and only once it's actually due.
create or replace function public.jobs_lock_remit()
returns trigger
language plpgsql
as $$
begin
  if new.remitted is distinct from old.remitted then
    if auth.uid() is distinct from old.worker_id then
      raise exception 'Only the worker can remit their own commission.';
    end if;
    if old.status is distinct from 'completed' then
      raise exception 'You can only remit a completed job.';
    end if;
    if old.remitted then
      raise exception 'This job has already been remitted.';
    end if;
    if new.remitted then
      new.remitted_at := now();
    end if;
  end if;
  return new;
end;
$$;

create or replace trigger jobs_lock_remit_trigger
before update on public.jobs
for each row execute function public.jobs_lock_remit();

grant update (remitted) on public.jobs to authenticated;

-- 18. How the customer actually paid: through the app, or directly to the
--     worker (cash/mobile money outside HandyHub). A direct payment needs a
--     transaction code as a record of it, since there's no in-app receipt.
alter table public.jobs add column if not exists payment_method text check (payment_method in ('in_app', 'direct'));
alter table public.jobs add column if not exists transaction_code text;

grant update (payment_method, transaction_code) on public.jobs to authenticated;

create or replace function public.jobs_lock_payment_method()
returns trigger
language plpgsql
as $$
begin
  if new.payment_method is distinct from old.payment_method or new.transaction_code is distinct from old.transaction_code then
    if auth.uid() is distinct from old.customer_id then
      raise exception 'Only the customer can record how a job was paid.';
    end if;
    if old.status in ('completed', 'cancelled') then
      raise exception 'This job is already settled.';
    end if;
    if new.payment_method = 'direct' and coalesce(trim(new.transaction_code), '') = '' then
      raise exception 'Enter the transaction code for a direct payment.';
    end if;
  end if;
  return new;
end;
$$;

create or replace trigger jobs_lock_payment_method_trigger
before update on public.jobs
for each row execute function public.jobs_lock_payment_method();

-- ---------------------------------------------------------------------------
-- Manual step: creating/activating an agent (no self-serve sign-up yet).
-- Have them sign up as a customer or worker first (so auth + a base profile
-- row exist), then run, as an operator with a direct DB connection. The
-- referral code is generated automatically (see section 11 above) — no need
-- to invent one:
--
--   update public.profiles
--   set role = 'agent', agent_active = true
--   where id = '00000000-0000-0000-0000-000000000000';
--
-- To deactivate an agent again: set agent_active = false (their recruits and
-- referral code stay intact).
-- ---------------------------------------------------------------------------
