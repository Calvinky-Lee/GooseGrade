/**
 * Copyright (c) 2025 GooseGrade
 * All rights reserved.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { supabase } from './db';

async function checkProgress() {
  try {
    // Count courses
    const { count: coursesCount, error: coursesError } = await supabase
      .from('courses')
      .select('*', { count: 'exact', head: true });

    if (coursesError) throw coursesError;

    // Count assessments
    const { count: assessmentsCount, error: assessmentsError } = await supabase
      .from('assessments')
      .select('*', { count: 'exact', head: true });

    if (assessmentsError) throw assessmentsError;

    // Count courses by term
    const { data: coursesByTerm, error: termError } = await supabase
      .from('courses')
      .select('term')
      .order('term', { ascending: false });

    if (termError) throw termError;

    const termCounts: Record<string, number> = {};
    coursesByTerm?.forEach(c => {
      termCounts[c.term] = (termCounts[c.term] || 0) + 1;
    });

    // Get total courses in courses.txt
    const fs = require('fs');
    const coursesFile = path.join(__dirname, '../courses.txt');
    const coursesList = fs.existsSync(coursesFile)
      ? fs.readFileSync(coursesFile, 'utf-8')
          .split('\n')
          .filter((line: string) => line.trim() && !line.startsWith('#'))
          .length
      : 0;

    console.log('\n📊 Scraping Progress:\n');
    console.log(`   Total courses in courses.txt: ${coursesList}`);
    console.log(`   Courses scraped: ${coursesCount || 0}`);
    console.log(`   Assessments extracted: ${assessmentsCount || 0}`);
    console.log(`   Progress: ${coursesList > 0 ? ((coursesCount || 0) / coursesList * 100).toFixed(1) : 0}%`);
    
    if (Object.keys(termCounts).length > 0) {
      console.log('\n   Courses by term:');
      Object.entries(termCounts)
        .sort((a, b) => b[1] - a[1])
        .forEach(([term, count]) => {
          console.log(`     ${term}: ${count}`);
        });
    }

    console.log('\n');

  } catch (error: any) {
    console.error('❌ Error checking progress:', error.message);
    process.exit(1);
  }
}

checkProgress()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
