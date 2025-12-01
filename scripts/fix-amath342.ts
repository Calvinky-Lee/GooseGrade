import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function fixWeights() {
  console.log('Fetching AMATH 342 Fall 2025...');
  
  const { data: courses } = await supabase
    .from('courses')
    .select('id, code, name, term')
    .ilike('code', '%AMATH 342%')
    .eq('term', 'Fall 2025');

  if (!courses || courses.length === 0) {
    console.log('No courses found for AMATH 342 Fall 2025');
    return;
  }

  for (const course of courses) {
    console.log(`\n=== ${course.code} - ${course.term} ===`);
    
    const { data: assessments } = await supabase
      .from('assessments')
      .select('id, name, weight, total_weight')
      .eq('course_id', course.id)
      .order('order_index');

    if (!assessments || assessments.length === 0) {
      console.log('No assessments found');
      continue;
    }

    const currentTotal = assessments.reduce((sum, a) => sum + Number(a.weight), 0);
    console.log(`Current total weight: ${currentTotal.toFixed(2)}%`);
    
    if (Math.abs(currentTotal - 100) < 1) {
      console.log('✅ Weights already sum to ~100%, no fix needed');
      continue;
    }

    // Scale all weights proportionally to sum to 100%
    const scaleFactor = 100 / currentTotal;
    console.log(`Scaling factor: ${scaleFactor.toFixed(4)}`);
    
    const updates = assessments.map(a => {
      const newWeight = Number(a.weight) * scaleFactor;
      const newTotalWeight = Number(a.total_weight) * scaleFactor;
      
      console.log(`  ${a.name}: ${Number(a.weight).toFixed(2)}% -> ${newWeight.toFixed(2)}%`);
      
      return {
        id: a.id,
        weight: parseFloat(newWeight.toFixed(10)),
        total_weight: parseFloat(newTotalWeight.toFixed(10))
      };
    });

    // Update each assessment
    for (const update of updates) {
      const { error } = await supabase
        .from('assessments')
        .update({ 
          weight: update.weight,
          total_weight: update.total_weight
        })
        .eq('id', update.id);
      
      if (error) {
        console.error(`Error updating ${update.id}:`, error);
      }
    }

    const newTotal = updates.reduce((sum, u) => sum + u.weight, 0);
    console.log(`\n✅ Updated! New total weight: ${newTotal.toFixed(2)}%`);
  }
}

fixWeights();


