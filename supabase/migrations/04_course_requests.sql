begin;
create table if not exists public.course_requests (
 id uuid primary key default gen_random_uuid(),
 course_code text not null check(course_code ~ '^[A-Z]{2,10} [0-9]{2,4}[A-Z]{0,2}$'),
 term_id integer not null check(term_id between 1000 and 1999 and term_id % 10 in (1,5,9)),
 outline_url text check(outline_url is null or (length(outline_url)<=1000 and outline_url ~ '^https://([a-zA-Z0-9-]+\.)*uwaterloo\.ca(/|$)')),
 notes text not null default '' check(length(notes)<=1000),
 status text not null default 'new' check(status in ('new','reviewed','resolved')),
 created_at timestamptz not null default now(),
 unique(course_code,term_id)
);
alter table public.course_requests enable row level security;
revoke all on public.course_requests from anon,authenticated;
grant insert(course_code,term_id,outline_url,notes) on public.course_requests to anon,authenticated;
grant all on public.course_requests to service_role;
drop policy if exists "Submit missing courses" on public.course_requests;
create policy "Submit missing courses" on public.course_requests for insert to anon,authenticated with check(status='new');
-- Requests are private: no public SELECT, UPDATE or DELETE privileges/policies.
notify pgrst,'reload schema';
commit;
