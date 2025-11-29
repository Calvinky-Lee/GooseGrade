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
    .ilike('code', '%MATH 137%')
    .limit(1);

  if (!courses || courses.length === 0) return;
  const courseId = courses[0].id;

  // Find "Quizzes 1"
  const { data: bad } = await supabase
    .from('assessments')
    .select('id, name')
    .eq('course_id', courseId)
    .eq('name', 'Quizzes 1')
    .single();

  if (bad) {
      console.log(`Renaming "${bad.name}" to "Quiz 1"...`);
      const { error } = await supabase
          .from('assessments')
          .update({ name: 'Quiz 1' })
          .eq('id', bad.id);
      
      if (error) console.error('Error:', error);
      else console.log('Success!');
  } else {
      console.log('"Quizzes 1" not found.');
  }
}

fix();

