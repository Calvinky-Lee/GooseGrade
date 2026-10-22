-- Integration checks are fully rolled back; no fixtures remain.
begin;
insert into public.course_offerings(code,name,department,term_id,term,term_date,source_url) values ('GGTEST 999','Import verification','GGTEST',1271,'Winter 2027','2027-01-01','https://classes.uwaterloo.ca/uwpcshtm.html');
create function pg_temp.reject_test_assessment() returns trigger language plpgsql as $$ begin if new.name='Reject test insertion' then raise exception 'Test insertion failure'; end if; return new; end $$;
create trigger goosegrade_test_rejection before insert or update on public.assessments for each row execute function pg_temp.reject_test_assessment();
do $$
declare c jsonb := '{"code":"GGTEST 999","name":"Original","department":"GGTEST","term_id":1271,"term":"Winter 2027","term_date":"2027-01-01","outline_url":"https://outline.uwaterloo.ca/viewer/view/verification","source_hash":"test"}';
 a jsonb := '[{"slug":"exam","name":"Exam","category":"Exam","weight":"100.0000000000","raw_weight":100,"total_weight":100,"source_evidence":"Exam 100%"}]';
 cid uuid; again uuid; aid uuid; failed boolean := false;
begin
 if has_function_privilege('anon','public.publish_course_scheme(jsonb,jsonb)','execute') then raise exception 'Public can publish'; end if;
 if has_table_privilege('anon','public.assessments','update') then raise exception 'Public can update assessments'; end if;
 if not has_table_privilege('anon','public.course_offerings','select') then raise exception 'Public cannot read offerings'; end if;
 cid:=public.publish_course_scheme(c,a);
 select id into aid from public.assessments where course_id=cid;
 again:=public.publish_course_scheme(c,a);
 if again<>cid or aid<>(select id from public.assessments where course_id=cid) then raise exception 'Rerun changed stable identity'; end if;
 begin
  perform public.publish_course_scheme(c||'{"name":"Changed"}'::jsonb,jsonb_set(a,'{0,name}','"Reject test insertion"'::jsonb));
 exception when others then
  if sqlerrm<>'Test insertion failure' then raise; end if; failed:=true;
 end;
 if not failed or (select name from public.courses where id=cid)<>'Original' or (select name from public.assessments where id=aid)<>'Exam' then raise exception 'Atomic replacement did not roll back'; end if;
 failed:=false;
 begin perform public.publish_course_scheme(c,jsonb_set(a,'{0,weight}','"99.0"'::jsonb)); exception when others then if sqlerrm<>'Weights must total exactly 100' then raise; end if; failed:=true; end;
 if not failed then raise exception 'Invalid sum accepted'; end if;
end $$;
select 'PASS: permissions, exact total, idempotency, stable assessment identity, rollback after write failure' as verification;
rollback;
