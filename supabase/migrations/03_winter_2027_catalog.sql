-- Additive migration. Historical courses and assessments remain intact.
begin;
create table if not exists public.course_offerings (
 code text not null, name text not null, department text not null,
 term_id integer not null check (term_id between 1000 and 1999 and term_id % 10 in (1,5,9)),
 term text not null, term_date date not null, source_url text not null,
 source_variants jsonb not null default '[]', fetched_at timestamptz not null default now(),
 outline_status text not null default 'pending' check(outline_status in ('pending','ready','review','error')),
 checked_at timestamptz, primary key(code,term_id)
);
alter table public.course_offerings enable row level security;
drop policy if exists "Public can read offerings" on public.course_offerings;
create policy "Public can read offerings" on public.course_offerings for select using(true);
grant select on public.course_offerings to anon,authenticated;
grant all on public.course_offerings to service_role;
revoke insert,update,delete on public.course_offerings from anon,authenticated;
alter table public.courses add column if not exists validation_status text not null default 'legacy';
alter table public.courses add column if not exists source_hash text;
alter table public.courses add column if not exists retrieved_at timestamptz;
alter table public.courses add column if not exists extraction_version text;
alter table public.courses add column if not exists review_reasons jsonb not null default '[]';
alter table public.assessments add column if not exists course_code text;
alter table public.assessments add column if not exists slug text;
alter table public.assessments add column if not exists raw_weight numeric(20,10);
alter table public.assessments add column if not exists group_name text not null default '';
alter table public.assessments add column if not exists source_evidence text;
alter table public.assessments alter column weight type numeric(20,10), alter column total_weight type numeric(20,10);
create unique index if not exists assessment_course_slug on public.assessments(course_id,slug);
create index if not exists offerings_term_code on public.course_offerings(term_id,code);
create index if not exists courses_term_code on public.courses(term,code);
revoke insert,update,delete on public.courses,public.assessments from anon,authenticated;

create or replace function public.publish_course_scheme(p_course jsonb,p_assessments jsonb)
returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare cid uuid; tid integer; expected_term text; expected_date date; a jsonb; total numeric; n integer;
begin
 tid := (p_course->>'term_id')::integer;
 if tid not between 1000 and 1999 or tid%10 not in (1,5,9) then raise exception 'Invalid term'; end if;
 expected_term := (case tid%10 when 1 then 'Winter' when 5 then 'Spring' else 'Fall' end)||' '||(1900+tid/10)::text;
 expected_date := make_date(1900+tid/10,tid%10,1);
 if p_course->>'term' is distinct from expected_term or (p_course->>'term_date')::date is distinct from expected_date then raise exception 'Term mismatch'; end if;
 if coalesce(p_course->>'code','')='' or coalesce(p_course->>'name','')='' or coalesce(p_course->>'source_hash','')='' then raise exception 'Missing source identity'; end if;
 if coalesce(p_course->>'outline_url','') !~ '^https://outline\.uwaterloo\.ca/' then raise exception 'Invalid outline URL'; end if;
 if not exists(select 1 from public.course_offerings where code=p_course->>'code' and term_id=tid) then raise exception 'Offering not found'; end if;
 if jsonb_typeof(p_assessments) is distinct from 'array' or jsonb_array_length(p_assessments)=0 then raise exception 'Empty assessments'; end if;
 n:=jsonb_array_length(p_assessments);
 if n<>(select count(distinct value->>'slug') from jsonb_array_elements(p_assessments)) or n<>(select count(distinct lower(trim(value->>'name'))) from jsonb_array_elements(p_assessments)) then raise exception 'Duplicate assessment identity'; end if;
 for a in select value from jsonb_array_elements(p_assessments) loop
  if coalesce(a->>'slug','') !~ '^[a-z0-9-]+$' or coalesce(trim(a->>'name'),'')='' or coalesce(a->>'source_evidence','')='' then raise exception 'Missing assessment identity or evidence'; end if;
  if (a->>'weight') is null or (a->>'raw_weight') is null or (a->>'total_weight') is null or (a->>'weight')::numeric not between 0 and 100 or (a->>'raw_weight')::numeric not between 0 and 100 or (a->>'total_weight')::numeric not between 0 and 100 then raise exception 'Invalid assessment weight'; end if;
  if (a->>'weight')::numeric<>round((a->>'weight')::numeric,10) then raise exception 'Weight precision exceeds storage'; end if;
 end loop;
 select sum((value->>'weight')::numeric) into total from jsonb_array_elements(p_assessments);
 if total<>100 then raise exception 'Weights must total exactly 100'; end if;
 -- Serialize concurrent replacements for the same outline.
 perform pg_advisory_xact_lock(hashtextextended((p_course->>'code')||expected_term||(p_course->>'outline_url'),0));
 insert into public.courses(code,name,department,term,term_date,outline_url,last_scraped,validation_status,source_hash,retrieved_at,extraction_version,review_reasons)
 values(p_course->>'code',p_course->>'name',p_course->>'department',expected_term,expected_date,p_course->>'outline_url',now(),'ready',p_course->>'source_hash',now(),'winter-2027-v1',coalesce(p_course->'review_reasons','[]'))
 on conflict(code,term,outline_url) do update set name=excluded.name,department=excluded.department,term_date=excluded.term_date,last_scraped=excluded.last_scraped,validation_status='ready',source_hash=excluded.source_hash,retrieved_at=excluded.retrieved_at,extraction_version=excluded.extraction_version,review_reasons=excluded.review_reasons returning id into cid;
 insert into public.assessments(course_id,course_code,slug,name,category,weight,raw_weight,total_weight,group_name,source_evidence,assessment_type,order_index,term,term_date)
 select cid,p_course->>'code',value->>'slug',value->>'name',coalesce(value->>'category','Other'),(value->>'weight')::numeric,(value->>'raw_weight')::numeric,(value->>'total_weight')::numeric,coalesce(value->>'group_name',''),value->>'source_evidence',coalesce(value->>'category','Other'),ordinality::integer-1,expected_term,expected_date from jsonb_array_elements(p_assessments) with ordinality
 on conflict(course_id,slug) do update set name=excluded.name,category=excluded.category,weight=excluded.weight,raw_weight=excluded.raw_weight,total_weight=excluded.total_weight,group_name=excluded.group_name,source_evidence=excluded.source_evidence,assessment_type=excluded.assessment_type,order_index=excluded.order_index,term=excluded.term,term_date=excluded.term_date;
 delete from public.assessments where course_id=cid and (slug is null or slug not in(select value->>'slug' from jsonb_array_elements(p_assessments)));
 update public.course_offerings set outline_status='ready',checked_at=now() where code=p_course->>'code' and term_id=tid;
 return cid;
end $$;
revoke all on function public.publish_course_scheme(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.publish_course_scheme(jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
