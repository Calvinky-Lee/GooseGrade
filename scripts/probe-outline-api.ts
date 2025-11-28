import fetch from 'node-fetch';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function probeOutline() {
  const cookie = process.env.WATERLOO_SESSION_COOKIE || '';
  const headers = { 
    'Cookie': cookie, 
    'Accept': 'application/json', 
    'User-Agent': 'Mozilla/5.0',
    'X-Requested-With': 'XMLHttpRequest'
  };

  const id = 'n7np2k'; // The ID for CS 135 Fall 2025 we found earlier
  console.log(`🕵️ Probing for Outline JSON (ID: ${id})...`);

  const urls = [
    `https://outline.uwaterloo.ca/api/view/${id}`,
    `https://outline.uwaterloo.ca/api/outline/${id}`,
    `https://outline.uwaterloo.ca/viewer/api/view/${id}`,
    `https://outline.uwaterloo.ca/viewer/view/${id}` // Standard URL with JSON header
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, { headers });
      const type = res.headers.get('content-type') || '';
      
      console.log(`Testing ${url}`);
      console.log(`  -> Status: ${res.status}`);
      console.log(`  -> Type: ${type}`);

      if (res.status === 200 && type.includes('json')) {
        const text = await res.text();
        console.log('🎉 FOUND JSON OUTLINE!', url);
        // Print first 500 chars to see structure
        console.log('Preview:', text.substring(0, 500));
        return;
      }
    } catch (e) {
      console.log(`Failed ${url}`);
    }
  }
  
  console.log('❌ No JSON API for outline details found. Must use HTML parsing.');
}

probeOutline();

