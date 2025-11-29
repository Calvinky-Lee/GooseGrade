import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function audit() {
  console.log('Fetching courses...');
  const { data: courses } = await supabase
    .from('courses')
    .select('id, code, name, term');

  if (!courses) return;

  console.log(`Auditing ${courses.length} courses...`);
  
  const reportLines: string[] = [];
  let badCount = 0;

  for (const course of courses) {
    const { data: assessments } = await supabase
      .from('assessments')
      .select('name, weight')
      .eq('course_id', course.id);

    if (!assessments || assessments.length === 0) continue;

    const totalWeight = assessments.reduce((sum, a) => sum + a.weight, 0);

    // Tolerance of 1%
    if (totalWeight < 99 || totalWeight > 101) {
      badCount++;
      reportLines.push(`[${course.code}] ${course.name} (${course.term})`);
      reportLines.push(`  Total Weight: ${totalWeight.toFixed(2)}%`);
      
      // Group by name to spot obvious dups
      assessments.sort((a, b) => b.weight - a.weight);
      assessments.forEach(a => {
          reportLines.push(`    - ${a.name}: ${a.weight}%`);
      });
      reportLines.push('');
    }
  }

  fs.writeFileSync('weight_audit_report.txt', reportLines.join('\n'));
  console.log(`\nFound ${badCount} courses with weight issues (outside 99-101%).`);
  console.log('Report saved to weight_audit_report.txt');
}

audit();

