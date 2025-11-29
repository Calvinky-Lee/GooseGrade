import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function inspect() {
  const { data: courses } = await supabase
    .from('courses')
    .select('id')
    .ilike('code', '%MATH 137%')
    .limit(1);

  if (!courses || courses.length === 0) {
      console.log('Course not found');
      return;
  }
  
  const courseId = courses[0].id;
  
  const { data: assessments } = await supabase
    .from('assessments')
    .select('*')
    .eq('course_id', courseId)
    .order('name');
    
  console.log('Assessments for MATH 137:');
  assessments?.forEach(a => {
      console.log(`- [${a.name}] (Weight: ${a.weight}%)`);
  });
}

inspect();

