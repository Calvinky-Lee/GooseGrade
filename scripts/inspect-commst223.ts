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
    .select('id, code, name, term')
    .ilike('code', '%COMMST 223%')
    .order('term_date', { ascending: false }); // Get latest

  if (!courses || courses.length === 0) {
      console.log('Course not found');
      return;
  }
  
  console.log(`Found ${courses.length} sections for COMMST 223.`);
  
  for (const course of courses) {
      console.log(`\n[${course.code}] ${course.name} (${course.term}) - ID: ${course.id}`);
      
      const { data: assessments } = await supabase
        .from('assessments')
        .select('*')
        .eq('course_id', course.id)
        .order('name');
        
      let totalWeight = 0;
      assessments?.forEach(a => {
          console.log(`  - ${a.name}: ${a.weight}% (Type: ${a.assessment_type})`);
          totalWeight += a.weight;
      });
      console.log(`  TOTAL WEIGHT: ${totalWeight.toFixed(2)}%`);
  }
}

inspect();


