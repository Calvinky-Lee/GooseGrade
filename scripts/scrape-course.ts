import { parseCourseOutline } from './scraper/outlineParser';
import { supabase, Course, Assessment } from './db';

async function scrapeAndStoreCourse(courseCode: string) {
  try {
    console.log(`\n🔍 Scraping ${courseCode}...`);
    
    // 1. Parse the outline
    const parsed = await parseCourseOutline(courseCode);
    
    console.log(`📚 Found: ${parsed.name} (${parsed.term})`);
    
    // 2. Check if course exists
    const { data: existingCourse } = await supabase
      .from('courses')
      .select('id')
      .eq('code', parsed.code)
      .eq('term', parsed.term)
      .single();

    let courseId: string;

    if (existingCourse) {
      console.log(`🔄 Updating existing course...`);
      const { data: updatedCourse, error: updateError } = await supabase
        .from('courses')
        .update({
          name: parsed.name,
          department: parsed.department,
          term_date: parsed.termDate,
          outline_url: parsed.outlineUrl,
          last_scraped: new Date()
        })
        .eq('id', existingCourse.id)
        .select('id')
        .single();

      if (updateError) throw updateError;
      courseId = updatedCourse.id;

      // Clean up old assessments to avoid duplicates
      // (We replace them because weights/counts might have changed)
      await supabase.from('assessments').delete().eq('course_id', courseId);
    } else {
      console.log(`➕ Creating new course...`);
      const courseData: Course = {
        code: parsed.code,
        name: parsed.name,
        department: parsed.department,
        term: parsed.term,
        term_date: parsed.termDate,
        outline_url: parsed.outlineUrl,
        last_scraped: new Date()
      };
      
      const { data: insertedCourse, error: insertError } = await supabase
        .from('courses')
        .insert(courseData)
        .select('id')
        .single();
        
      if (insertError) throw insertError;
      courseId = insertedCourse.id;
    }
    
    // 3. Insert Assessments (Expanded)
    if (parsed.assessments.length > 0) {
      const assessmentsToInsert: Assessment[] = [];
      let globalIndex = 0;

      for (const assessment of parsed.assessments) {
        // Expand grouped assessments (e.g., "Quiz 1-5" -> 5 rows)
        for (let i = 0; i < assessment.count; i++) {
          let name = assessment.name;
          
          // If count > 1, append number: "Quiz 1", "Quiz 2"
          if (assessment.count > 1) {
            name = `${assessment.name} ${i + 1}`;
            if (name.includes('Quizzes')) name = name.replace('Quizzes', 'Quiz');
            if (name.includes('Assignments')) name = name.replace('Assignments', 'Assignment');
          }
          
          assessmentsToInsert.push({
            course_id: courseId,
            course_code: parsed.code,
            name: name,
            category: assessment.category,
            weight: assessment.individualWeight,
            total_weight: assessment.totalWeight,
            assessment_type: assessment.assessmentType,
            order_index: globalIndex++,
            term: parsed.term,
            term_date: parsed.termDate
          });
        }
      }
      
      const { error: assessError } = await supabase
        .from('assessments')
        .insert(assessmentsToInsert);
        
      if (assessError) throw assessError;
      
      console.log(`✅ Inserted ${assessmentsToInsert.length} assessments for ${parsed.code}`);
    } else {
      console.warn(`⚠️  No assessments found for ${parsed.code}`);
    }
    
  } catch (error: any) {
    console.error(`❌ Error scraping ${courseCode}:`, error.message);
    throw error;
  }
}

// Main execution check
// If this module is the main entry point (run directly via node/tsx)
if (require.main === module) {
  const courseCode = process.argv[2];
  if (courseCode) {
    scrapeAndStoreCourse(courseCode)
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  }
}

export { scrapeAndStoreCourse };
