
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function inspectCourses() {
  console.log('--- Inspecting AMATH 331 ---');
  const { data: amathCourses } = await supabase
    .from('courses')
    .select('id, code, term')
    .ilike('code', 'AMATH 331%')
    .order('term', { ascending: false });

  if (amathCourses && amathCourses.length > 0) {
    const courseId = amathCourses[0].id;
    console.log(`Found AMATH 331 ID: ${courseId}`);
    const { data: assessments } = await supabase
      .from('assessments')
      .select('*')
      .eq('course_id', courseId)
      .order('order_index');
    console.table(assessments?.map(a => ({ name: a.name, weight: a.weight })));
  } else {
    console.log('AMATH 331 not found');
  }

  console.log('\n--- Inspecting AFM 111 ---');
  const { data: afmCourses } = await supabase
    .from('courses')
    .select('id, code, term')
    .ilike('code', 'AFM 111%')
    .order('term', { ascending: false });

  if (afmCourses && afmCourses.length > 0) {
    const courseId = afmCourses[0].id;
    console.log(`Found AFM 111 ID: ${courseId}`);
    const { data: assessments } = await supabase
      .from('assessments')
      .select('*')
      .eq('course_id', courseId)
      .order('name'); // Order by name to see duplicates easier
    console.table(assessments?.map(a => ({ name: a.name, weight: a.weight, id: a.id })));
  } else {
    console.log('AFM 111 not found');
  }
}

inspectCourses();

