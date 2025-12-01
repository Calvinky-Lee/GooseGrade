import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function fix() {
  const { data: courses } = await supabase
    .from('courses')
    .select('id')
    .ilike('code', '%COMMST 223%')
    .limit(1);

  if (!courses || courses.length === 0) return;
  const courseId = courses[0].id;
  
  console.log('Fixing COMMST 223...');

  // Fix Minor Assignments (1% -> 2.4%)
  const { data: assignments } = await supabase
    .from('assessments')
    .select('*')
    .eq('course_id', courseId)
    .ilike('name', 'Minor Assignment%');
    
  if (assignments) {
      for (const a of assignments) {
          if (a.name.includes('Total')) continue; // Should be deleted already but safety check
          console.log(`Updating ${a.name} to 2.4%`);
          await supabase.from('assessments').update({ weight: 2.4 }).eq('id', a.id);
      }
  }
  
  // Fix Quizzes (1.5% -> 1.333%)
  // To ensure total is 12% (approx)
  const { data: quizzes } = await supabase
    .from('assessments')
    .select('*')
    .eq('course_id', courseId)
    .ilike('name', 'Quiz%');
    
  if (quizzes) {
      for (const q of quizzes) {
          if (q.name.includes('Total')) continue;
          console.log(`Updating ${q.name} to 1.33%`);
          await supabase.from('assessments').update({ weight: 1.33 }).eq('id', q.id);
      }
  }
  
  console.log('Done.');
}

fix();


