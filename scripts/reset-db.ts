
import { supabase } from './db';

async function resetDatabase() {
  console.log('⚠️  DELETING ALL DATA from courses and assessments...');
  
  // Truncate tables (cascade deletes assessments automatically)
  const { error } = await supabase.from('courses').delete().neq('id', '00000000-0000-0000-0000-000000000000'); // Hack to delete all
  
  if (error) {
    console.error('❌ Error resetting database:', error.message);
  } else {
    console.log('✅ Database reset complete.');
  }
}

resetDatabase();

