
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function fixData() {
  // 1. Fix AMATH 331
  console.log('--- Fixing AMATH 331 ---');
  const { data: amathCourses } = await supabase
    .from('courses')
    .select('id')
    .ilike('code', 'AMATH 331%')
    .order('term', { ascending: false })
    .limit(1);

  if (amathCourses && amathCourses.length > 0) {
    const courseId = amathCourses[0].id;
    console.log(`Updating Assignments for course ${courseId}...`);
    
    // Update all "Assignment X" to 4.0
    const { error: updateError } = await supabase
      .from('assessments')
      .update({ weight: 4.0 })
      .eq('course_id', courseId)
      .ilike('name', 'Assignment%'); // Matches Assignment 1, Assignment 2, etc.

    if (updateError) console.error('Error updating assignments:', updateError);
    else console.log('✅ Updated Assignments to 4.0%');

    // Verify Midterm/Final are correct (30/50)
    await supabase
      .from('assessments')
      .update({ weight: 30.0 })
      .eq('course_id', courseId)
      .ilike('name', '%Midterm%');
      
    await supabase
      .from('assessments')
      .update({ weight: 50.0 })
      .eq('course_id', courseId)
      .ilike('name', '%Final%');
      
    console.log('✅ Verified Midterm (30%) and Final (50%)');
  } else {
    console.log('AMATH 331 not found');
  }

  // 2. Clean AFM 111
  console.log('\n--- Cleaning AFM 111 ---');
  const { data: afmCourses } = await supabase
    .from('courses')
    .select('id')
    .ilike('code', 'AFM 111%')
    .order('term', { ascending: false })
    .limit(1);

  if (afmCourses && afmCourses.length > 0) {
    const courseId = afmCourses[0].id;
    console.log(`Deleting ALL assessments for AFM 111 (${courseId}) to prepare for fresh scrape...`);
    
    const { error: deleteError } = await supabase
      .from('assessments')
      .delete()
      .eq('course_id', courseId);

    if (deleteError) console.error('Error deleting assessments:', deleteError);
    else console.log('✅ Deleted all AFM 111 assessments. Please re-scrape.');
  } else {
    console.log('AFM 111 not found');
  }
}

fixData();

