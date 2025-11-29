
import { supabase } from './db';

async function migrate() {
  console.log('🔄 Migrating database constraints...');

  try {
    // 1. Drop the old constraint
    const { error: dropError } = await supabase.rpc('exec_sql', {
      sql: 'ALTER TABLE courses DROP CONSTRAINT IF EXISTS unique_course_term;'
    });
    
    // Note: Supabase JS client doesn't support running raw SQL directly unless enabled via RPC or using the Postgres connection string.
    // However, for this project, I see `scripts/setup-database.ts` exists. Let's see how it works.
  } catch (e) {
    console.error(e);
  }
}

