import { supabase } from './db';

async function testConnection() {
  console.log('Testing Supabase connection...');
  console.log('URL:', process.env.NEXT_PUBLIC_SUPABASE_URL); // Will print URL to verify
  
  try {
    const { data, error } = await supabase.from('courses').select('id').limit(1);
    if (error) {
      console.error('❌ Supabase API Error:', error.message);
      console.error('   Details:', error);
    } else {
      console.log('✅ Supabase Connected Successfully!');
    }
  } catch (e) {
    console.error('❌ Network/Fetch Error:', e);
  }
}

testConnection();

