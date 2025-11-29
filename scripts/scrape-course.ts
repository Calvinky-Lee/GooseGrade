import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { parseCourseOutline } from './scraper/outlineParser';
import { supabase, Course, Assessment } from './db';

async function scrapeAndStoreCourse(courseCode: string) {
  try {
    console.log(`\n🔍 Scraping ${courseCode}...`);
    
    // 1. Parse all outlines for the latest term
    const parsedCourses = await parseCourseOutline(courseCode);
    
    console.log(`📚 Found ${parsedCourses.length} outline(s) for the latest term.`);

    for (const parsed of parsedCourses) {
        console.log(`\nProcessing: ${parsed.name} (${parsed.term})`);

        // 2. Check if specific course section exists
        // We might want to use outline_url as a unique identifier for sections if code+term is not unique enough
        // Or assume name distinguishes them (e.g. "Section 001")
        
        const { data: existingCourse } = await supabase
          .from('courses')
          .select('id')
          .eq('code', parsed.code)
          .eq('term', parsed.term)
          .eq('outline_url', parsed.outlineUrl) // Use URL to distinguish sections
          .single();
    
        let courseId: string;
    
        if (existingCourse) {
          console.log(`🔄 Updating existing course section...`);
          const { data: updatedCourse, error: updateError } = await supabase
            .from('courses')
            .update({
              name: parsed.name,
              department: parsed.department,
              term_date: parsed.termDate,
              last_scraped: new Date()
            })
            .eq('id', existingCourse.id)
            .select('id')
            .single();
    
          if (updateError) throw updateError;
          courseId = updatedCourse.id;
    
          // Clean up old assessments
          await supabase.from('assessments').delete().eq('course_id', courseId);
        } else {
          console.log(`➕ Creating new course section...`);
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
        
        // 3. Insert Assessments
        if (parsed.assessments.length > 0) {
          const assessmentsToInsert: Assessment[] = [];
          let globalIndex = 0;
    
          for (const assessment of parsed.assessments) {
            // Expand grouped assessments
            for (let i = 0; i < assessment.count; i++) {
              let name = assessment.name;
              
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
          
          console.log(`✅ Inserted ${assessmentsToInsert.length} assessments`);
        } else {
          console.warn(`⚠️  No assessments found`);
        }
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
