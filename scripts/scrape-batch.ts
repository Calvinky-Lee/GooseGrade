import { scrapeAndStoreCourse } from './scrape-course'; // This works via TS/CommonJS interop
import * as fs from 'fs';
import * as path from 'path';

// Helper for delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function scrapeBatch(courseCodes: string[]) {
  const delayMs = parseInt(process.env.SCRAPER_DELAY_MS || '2000');
  console.log(`🚀 Batch scraping ${courseCodes.length} courses...`);
  
  const missingOutlines: string[] = [];
  const errorLogPath = path.join(process.cwd(), 'missing_outlines.txt');
  
  // Clear previous log
  fs.writeFileSync(errorLogPath, `Missing Outlines Log - ${new Date().toISOString()}\n\n`);

  for (let i = 0; i < courseCodes.length; i++) {
    const code = courseCodes[i];
    try {
      // @ts-ignore
      await scrapeAndStoreCourse(code);
    } catch (e: any) {
      const msg = e.message || String(e);
      
      if (msg.includes('No outlines found') || msg.includes('404')) {
        console.error(`⚠️  Skipping ${code}: No outline available.`);
        missingOutlines.push(code);
        // Append strictly to file immediately so we don't lose data if script crashes
        fs.appendFileSync(errorLogPath, `${code} - ${msg}\n`);
      } else {
        console.error(`❌ Failed to scrape ${code}: ${msg}`);
        fs.appendFileSync(errorLogPath, `${code} - ERROR: ${msg}\n`);
      }
    }
    
    if (i < courseCodes.length - 1) await delay(delayMs);
  }
  
  console.log('\n==================================================');
  console.log(`🏁 Batch Complete!`);
  console.log(`✅ Success: ${courseCodes.length - missingOutlines.length}`);
  console.log(`⚠️  Missing/Failed: ${missingOutlines.length}`);
  console.log(`📄 See missing_outlines.txt for details.`);
  console.log('==================================================\n');
}

const input = process.argv[2];
if (!input) {
  console.log('Usage: npm run scrape-batch <course1,course2> or <file.txt>');
  process.exit(1);
}

let codes: string[] = [];
if (fs.existsSync(input)) {
  codes = fs.readFileSync(input, 'utf-8').split('\n').map(c => c.trim()).filter(c => c && !c.startsWith('#'));
} else {
  codes = input.split(',').map(c => c.trim());
}

scrapeBatch(codes);
