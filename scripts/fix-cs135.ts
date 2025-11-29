
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function fixCS135() {
  console.log('--- Fixing CS 135 ---');
  const { data: courses } = await supabase
    .from('courses')
    .select('id, term, term_date')
    .ilike('code', 'CS 135%')
    .order('term', { ascending: false })
    .limit(1);

  if (courses && courses.length > 0) {
    const courseId = courses[0].id;
    const term = courses[0].term;
    const termDate = courses[0].term_date;
    console.log(`Found CS 135 ID: ${courseId}, Term: ${term}, Date: ${termDate}`);
    
    // 1. Delete existing assessments
    const { error: deleteError } = await supabase
      .from('assessments')
      .delete()
      .eq('course_id', courseId);
      
    if (deleteError) {
        console.error('Error deleting:', deleteError);
        return;
    }
    console.log('Deleted existing assessments.');

    // 2. Insert correct assessments
    const assessments = [];
    
    // Assignments 1-10 (2% each)
    for (let i = 1; i <= 10; i++) {
        assessments.push({
            course_id: courseId,
            name: `Assignment ${i}`, 
            weight: 2.0,
            total_weight: 2.0,
            assessment_type: 'Assignment',
            term: term,
            term_date: termDate,
            order_index: i
        });
    }
    
    // Midterm (25%)
    assessments.push({
        course_id: courseId,
        name: 'Midterm Exam',
        weight: 25.0,
        total_weight: 25.0,
        assessment_type: 'Midterm',
        term: term,
        term_date: termDate,
        order_index: 11
    });
    
    // Final (45%)
    assessments.push({
        course_id: courseId,
        name: 'Final Exam',
        weight: 45.0,
        total_weight: 45.0,
        assessment_type: 'Final Exam',
        term: term,
        term_date: termDate,
        order_index: 12
    });
    
    // Participation (10%)
    assessments.push({
        course_id: courseId,
        name: 'Class Participation (iClicker)',
        weight: 10.0,
        total_weight: 10.0,
        assessment_type: 'Participation',
        term: term,
        term_date: termDate,
        order_index: 13
    });

    const { error: insertError } = await supabase
      .from('assessments')
      .insert(assessments);

    if (insertError) console.error('Error inserting:', insertError);
    else console.log('✅ Successfully inserted 13 correct assessments for CS 135.');
    
  } else {
    console.log('CS 135 not found');
  }
}

fixCS135();

