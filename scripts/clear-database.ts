/**
 * Copyright (c) 2025 GooseGrade
 * All rights reserved.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { supabase } from './db';

async function clearDatabase() {
  try {
    console.log('🗑️  Clearing database...\n');

    // First, count existing records
    const { count: coursesCount } = await supabase
      .from('courses')
      .select('*', { count: 'exact', head: true });

    const { count: assessmentsCount } = await supabase
      .from('assessments')
      .select('*', { count: 'exact', head: true });

    console.log(`📊 Found ${coursesCount || 0} courses and ${assessmentsCount || 0} assessments`);

    // Delete all assessments first
    console.log('\n🗑️  Deleting all assessments...');
    const { error: assessmentsError } = await supabase
      .from('assessments')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all (using a condition that's always true)

    if (assessmentsError) {
      throw new Error(`Failed to delete assessments: ${assessmentsError.message}`);
    }

    console.log('✅ All assessments deleted');

    // Delete all courses (assessments should already be deleted, but CASCADE will handle any remaining)
    console.log('\n🗑️  Deleting all courses...');
    const { error: coursesError } = await supabase
      .from('courses')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all (using a condition that's always true)

    if (coursesError) {
      throw new Error(`Failed to delete courses: ${coursesError.message}`);
    }

    console.log('✅ All courses deleted');

    // Verify deletion
    const { count: coursesAfter } = await supabase
      .from('courses')
      .select('*', { count: 'exact', head: true });

    const { count: assessmentsAfter } = await supabase
      .from('assessments')
      .select('*', { count: 'exact', head: true });

    console.log('\n✨ Database cleared successfully!');
    console.log(`   Courses remaining: ${coursesAfter || 0}`);
    console.log(`   Assessments remaining: ${assessmentsAfter || 0}`);

  } catch (error: any) {
    console.error('\n❌ Error clearing database:', error.message);
    throw error;
  }
}

// Run the script
if (require.main === module) {
  clearDatabase()
    .then(() => {
      console.log('\n✅ Done!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Fatal error:', error);
      process.exit(1);
    });
}

export { clearDatabase };
