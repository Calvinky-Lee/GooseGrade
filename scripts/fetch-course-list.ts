import * as cheerio from 'cheerio';
import fetch from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';

const COURSE_LIST_URL = 'https://classes.uwaterloo.ca/uwpcshtm.html';
const OUTPUT_FILE = path.join(__dirname, '../courses.txt');

async function fetchCourseList() {
  console.log(`\n🌍 Fetching course list from ${COURSE_LIST_URL}...`);
  
  try {
    const response = await fetch(COURSE_LIST_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch course list: ${response.statusText}`);
    }
    
    const html = await response.text();
    const $ = cheerio.load(html);
    
    const courses = new Set<string>();
    
    // The table structure based on your link:
    // | Subject | Cat Nbr | Title | ...
    // usually in a main <table>
    
    $('table tr').each((_, element) => {
      const tds = $(element).find('td');
      
      // We need at least Subject (col 0) and Cat Nbr (col 1)
      if (tds.length >= 2) {
        const subject = $(tds[0]).text().trim();
        const catNbr = $(tds[1]).text().trim();
        
        // Validation: Subject should be letters, Cat Nbr should be numbers/letters
        if (subject && catNbr && /^[A-Z]+$/.test(subject) && /^\d+[A-Z]*$/.test(catNbr)) {
          courses.add(`${subject} ${catNbr}`);
        }
      }
    });
    
    const sortedCourses = Array.from(courses).sort();
    
    console.log(`✅ Found ${sortedCourses.length} unique courses.`);
    
    // Write to file
    const fileContent = `# Auto-generated course list from ${COURSE_LIST_URL}\n` + 
                        `# Generated at ${new Date().toISOString()}\n\n` + 
                        sortedCourses.join('\n');
                        
    fs.writeFileSync(OUTPUT_FILE, fileContent);
    console.log(`💾 Saved course list to ${OUTPUT_FILE}`);
    console.log(`\n🚀 To start scraping these courses, run:\n   npm run scrape-batch courses.txt`);
    
  } catch (error: any) {
    console.error('❌ Error fetching course list:', error.message);
  }
}

fetchCourseList();

