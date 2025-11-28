import fetch from 'node-fetch';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load env vars
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function probe() {
  const cookie = process.env.WATERLOO_SESSION_COOKIE || '';
  const headers = { 
    'Cookie': cookie, 
    'Accept': 'application/json', 
    'User-Agent': 'Mozilla/5.0',
    'X-Requested-With': 'XMLHttpRequest' // Common for AJAX
  };

  console.log('🕵️ Probing for API...');

  // Found the winning URL pattern, let's refine the query
  const winningUrl = 'https://outline.uwaterloo.ca/api/search';
  
  const testQueries = [
    `${winningUrl}?q=CS135`,
    `${winningUrl}?q=CS%20135`, // Space
    `${winningUrl}?q=cs135`,     // Lowercase
    `${winningUrl}?q=cs%20135`   // Lowercase space
  ];

  for (const url of testQueries) {
    try {
      const res = await fetch(url, { headers });
      if (res.status === 200) {
        const text = await res.text();
        console.log(`Testing ${url}`);
        console.log('Preview:', text.substring(0, 200));
      }
    } catch (e) {
      console.log(`Failed ${url}`);
    }
  }
}

probe();

