import { supabase } from './db';

async function checkCourse(code: string) {
  const { data: courses } = await supabase
    .from('courses')
    .select('id, code, term')
    .eq('code', code);
    
  for (const course of courses || []) {
    const { data: assessments } = await supabase
      .from('assessments')
      .select('name, weight')
      .eq('course_id', course.id)
      .gt('weight', 0)
      .order('order_index');
      
    if (assessments && assessments.length > 0) {
      const total = assessments.reduce((s, a) => s + Number(a.weight), 0);
      console.log(`\n${course.code} ${course.term}:`);
      console.log(`Total weight: ${total.toFixed(6)}%`);
      assessments.forEach(a => {
        console.log(`  - ${a.name}: ${Number(a.weight).toFixed(6)}%`);
      });
    }
  }
}

(async () => {
  await checkCourse('MTE 121');
  await checkCourse('MTE 100');
  await checkCourse('MATH 115');
  await checkCourse('MATH 116');
})();

