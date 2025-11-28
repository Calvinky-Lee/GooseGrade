import * as fs from 'fs';
import * as path from 'path';

async function setupDatabase() {
  console.log('📊 Setting up database schema...');
  
  // Read SQL schema file
  const schemaPath = path.join(__dirname, '../supabase/schema.sql');
  
  if (!fs.existsSync(schemaPath)) {
    console.error(`❌ Schema file not found at ${schemaPath}`);
    process.exit(1);
  }
  
  const sql = fs.readFileSync(schemaPath, 'utf-8');
  
  console.log('\n📋 SQL Schema to execute in Supabase:');
  console.log('─'.repeat(60));
  console.log(sql);
  console.log('─'.repeat(60));
  console.log('\n📝 Instructions:');
  console.log('1. Go to Supabase Dashboard -> SQL Editor');
  console.log('2. Copy/Paste the SQL above');
  console.log('3. Run the query');
}

setupDatabase();

