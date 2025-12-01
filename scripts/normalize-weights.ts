import { supabase } from './db';

/**
 * Normalize assessment weights so each course/section always sums to exactly 100%
 * This scales all weights proportionally to ensure they add up to 100%
 */
async function normalizeWeights() {
  console.log('🔍 Fetching all courses...');
  
  // Get all courses (fetch in batches to handle all courses)
  let allCourses: any[] = [];
  let offset = 0;
  const batchSize = 1000;
  
  while (true) {
    const { data: courses, error: coursesError } = await supabase
      .from('courses')
      .select('id, code, term')
      .range(offset, offset + batchSize - 1);
      
    if (coursesError) {
      console.error('❌ Error fetching courses:', coursesError);
      return;
    }
    
    if (!courses || courses.length === 0) break;
    
    allCourses = allCourses.concat(courses);
    offset += batchSize;
    
    if (courses.length < batchSize) break;
  }
  
  const courses = allCourses;
  
  if (courses.length === 0) {
    console.log('No courses found.');
    return;
  }
  
  console.log(`📚 Found ${courses.length} courses`);
  
  let totalFixed = 0;
  let totalSkipped = 0;
  
  for (const course of courses) {
    // Get all assessments for this course with weight > 0 (matching UI filter)
    const { data: assessments, error: assessError } = await supabase
      .from('assessments')
      .select('id, name, weight')
      .eq('course_id', course.id)
      .gt('weight', 0)
      .order('order_index');
      
    if (assessError) {
      console.error(`❌ Error fetching assessments for ${course.code} ${course.term}:`, assessError);
      continue;
    }
    
    if (!assessments || assessments.length === 0) {
      console.log(`⏭️  Skipping ${course.code} ${course.term}: No assessments with weight > 0`);
      totalSkipped++;
      continue;
    }
    
    // Calculate total weight
    const totalWeight = assessments.reduce((sum, a) => sum + Number(a.weight), 0);
    
    // Check if it's already exactly 100% (use very strict tolerance)
    const tolerance = 0.001; // Very strict - only skip if extremely close
    if (Math.abs(totalWeight - 100) < tolerance) {
      totalSkipped++;
      continue; // Already normalized
    }
    
    // Calculate scale factor to make total = 100
    const scaleFactor = 100 / totalWeight;
    
    console.log(`\n📊 ${course.code} ${course.term}:`);
    console.log(`   Current total: ${totalWeight.toFixed(6)}%`);
    console.log(`   Scale factor: ${scaleFactor.toFixed(6)}`);
    console.log(`   Adjusting ${assessments.length} assessments...`);
    
    // Calculate new weights for all but the last assessment
    const newWeights: { id: string; weight: number }[] = [];
    let runningTotal = 0;
    
    for (let i = 0; i < assessments.length - 1; i++) {
      const newWeight = Number(assessments[i].weight) * scaleFactor;
      newWeights.push({ id: assessments[i].id, weight: newWeight });
      runningTotal += newWeight;
    }
    
    // For the last assessment, make it exactly (100 - runningTotal) to ensure exact 100%
    const lastAssessment = assessments[assessments.length - 1];
    const lastWeight = 100 - runningTotal;
    newWeights.push({ id: lastAssessment.id, weight: lastWeight });
    
    // Update all assessments
    const updates = newWeights.map(({ id, weight }) =>
      supabase
        .from('assessments')
        .update({ weight: weight })
        .eq('id', id)
    );
    
    // Execute all updates
    const results = await Promise.all(updates);
    
    // Check for errors
    const errors = results.filter(r => r.error);
    if (errors.length > 0) {
      console.error(`   ❌ Errors updating ${course.code} ${course.term}:`, errors);
      continue;
    }
    
    // Verify the fix worked and force to exactly 100% if needed
    const { data: updatedAssessments } = await supabase
      .from('assessments')
      .select('id, weight')
      .eq('course_id', course.id)
      .gt('weight', 0)
      .order('order_index');
      
    if (updatedAssessments && updatedAssessments.length > 0) {
      let newTotal = updatedAssessments.reduce((sum, a) => sum + Number(a.weight), 0);
      
      // If still not exactly 100%, adjust the last assessment to make it exactly 100%
      if (Math.abs(newTotal - 100) >= tolerance) {
        const diff = 100 - newTotal;
        const lastAssessment = updatedAssessments[updatedAssessments.length - 1];
        const correctedWeight = Number(lastAssessment.weight) + diff;
        
        // Only adjust if the correction is reasonable (not negative)
        if (correctedWeight > 0) {
          await supabase
            .from('assessments')
            .update({ weight: correctedWeight })
            .eq('id', lastAssessment.id);
          
          // Re-read to verify
          const { data: finalAssessments } = await supabase
            .from('assessments')
            .select('weight')
            .eq('course_id', course.id)
            .gt('weight', 0);
          
          if (finalAssessments) {
            newTotal = finalAssessments.reduce((sum, a) => sum + Number(a.weight), 0);
          }
        }
      }
      
      console.log(`   ✅ New total: ${newTotal.toFixed(6)}%`);
      
      if (Math.abs(newTotal - 100) < tolerance) {
        totalFixed++;
      } else {
        console.error(`   ⚠️  Warning: Total is still not 100% (${newTotal.toFixed(6)}%)`);
      }
    }
  }
  
  console.log(`\n✨ Summary:`);
  console.log(`   Fixed: ${totalFixed}`);
  console.log(`   Skipped (already correct): ${totalSkipped}`);
  console.log(`   Total courses: ${courses.length}`);
}

// Run the script
normalizeWeights()
  .then(() => {
    console.log('\n✅ Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });

