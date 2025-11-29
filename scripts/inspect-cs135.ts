
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function inspectCS135() {
  console.log('--- Inspecting CS 135 ---');
  const { data: courses } = await supabase
    .from('courses')
    .select('id, code, term')
    .ilike('code', 'CS 135%')
    .order('term', { ascending: false });

  if (courses && courses.length > 0) {
    for (const course of courses) {
        console.log(`\nFound CS 135 (${course.term}) ID: ${course.id}`);
        const { data: assessments } = await supabase
        .from('assessments')
        .select('*')
        .eq('course_id', course.id)
        .order('order_index');
        
        console.table(assessments?.map(a => ({ name: a.name, weight: a.weight })));
        
        const totalWeight = assessments?.reduce((sum, a) => sum + Number(a.weight), 0);
        console.log(`Total Weight: ${totalWeight}%`);
    }
  } else {
    console.log('CS 135 not found');
  }
}

inspectCS135();

