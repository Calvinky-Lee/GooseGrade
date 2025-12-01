import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { scrapeAndStoreCourse } from './scrape-course';
import { supabase } from './db';

/**
 * Check if a course's weights sum to 100%
 */
async function checkCourseWeights(code: string): Promise<{ needsFix: boolean; total: number }> {
  const { data: courses } = await supabase
    .from('courses')
    .select('id, code, term')
    .eq('code', code)
    .order('term', { ascending: false })
    .limit(10); // Check latest 10 sections
    
  if (!courses || courses.length === 0) {
    console.log(`⚠️  No courses found for ${code}`);
    return { needsFix: false, total: 0 };
  }

  let needsFix = false;
  let maxTotal = 0;

  for (const course of courses) {
    const { data: assessments } = await supabase
      .from('assessments')
      .select('id, name, weight')
      .eq('course_id', course.id)
      .gt('weight', 0)
      .order('order_index');
      
    if (assessments && assessments.length > 0) {
      const total = assessments.reduce((s, a) => s + Number(a.weight), 0);
      console.log(`\n📊 ${course.code} ${course.term}:`);
      console.log(`   Total weight: ${total.toFixed(6)}%`);
      
      if (Math.abs(total - 100) >= 0.001) {
        needsFix = true;
        maxTotal = Math.max(maxTotal, total);
      }
    }
  }

  return { needsFix, total: maxTotal };
}

/**
 * Normalize weights for a specific course to sum to exactly 100%
 */
async function normalizeCourseWeights(code: string): Promise<void> {
  console.log(`\n🔧 Normalizing weights for ${code}...`);
  
  const { data: courses } = await supabase
    .from('courses')
    .select('id, code, term')
    .eq('code', code)
    .order('term', { ascending: false })
    .limit(10); // Normalize latest 10 sections

  if (!courses || courses.length === 0) {
    console.log(`⚠️  No courses found for ${code}`);
    return;
  }

  let totalFixed = 0;
  const tolerance = 0.001;

  for (const course of courses) {
    // Get all assessments for this course with weight > 0
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
      continue;
    }
    
    // Calculate total weight
    const totalWeight = assessments.reduce((sum, a) => sum + Number(a.weight), 0);
    
    // Check if it's already exactly 100%
    if (Math.abs(totalWeight - 100) < tolerance) {
      console.log(`✅ ${course.code} ${course.term}: Already at 100%`);
      continue;
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
    
    // Verify the fix worked
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

  console.log(`\n✨ Normalized ${totalFixed} course section(s) for ${code}`);
}

/**
 * Main function: Add a new course with full validation
 */
async function addCourse(courseCode: string) {
  try {
    console.log(`\n🚀 Adding course: ${courseCode}`);
    console.log('='.repeat(50));
    
    // Step 1: Scrape and store the course
    console.log('\n📥 Step 1: Scraping course outline...');
    await scrapeAndStoreCourse(courseCode);
    
    // Step 2: Check weights
    console.log('\n📊 Step 2: Checking course weights...');
    const { needsFix, total } = await checkCourseWeights(courseCode);
    
    // Step 3: Normalize if needed
    if (needsFix) {
      console.log(`\n⚠️  Weights don't sum to 100% (current: ${total.toFixed(2)}%)`);
      await normalizeCourseWeights(courseCode);
      
      // Verify after normalization
      console.log('\n✅ Step 3: Verifying weights after normalization...');
      await checkCourseWeights(courseCode);
    } else {
      console.log('\n✅ All weights sum to 100% - no normalization needed!');
    }
    
    console.log('\n' + '='.repeat(50));
    console.log(`✨ Successfully added ${courseCode} to the database!`);
    
  } catch (error: any) {
    console.error(`\n❌ Error adding course ${courseCode}:`, error.message);
    throw error;
  }
}

// Main execution
if (require.main === module) {
  const courseCode = process.argv[2];
  if (!courseCode) {
    console.error('Usage: npx tsx scripts/add-course.ts "COURSE CODE"');
    console.error('Example: npx tsx scripts/add-course.ts "CS 135"');
    process.exit(1);
  }
  
  addCourse(courseCode)
    .then(() => {
      console.log('\n✅ Done!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Fatal error:', error);
      process.exit(1);
    });
}

export { addCourse };

