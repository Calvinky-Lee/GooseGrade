import * as cheerio from 'cheerio';
import fetch from 'node-fetch';
import OpenAI from 'openai';

export interface ParsedAssessment {
  name: string;
  category: string;
  totalWeight: number; // For the group (if applicable) or individual if split
  count: number;
  individualWeight: number;
  assessmentType: string;
}

export interface ParsedCourse {
  code: string;
  name: string;
  department: string;
  term: string;
  termDate: string;
  assessments: ParsedAssessment[];
  outlineUrl: string;
}

// API Interfaces
interface ApiSearchResult {
  url: string;
  term: number;
  title?: string;
}

export function normalizeCourseCode(code: string): string {
  const cleaned = code.trim().toUpperCase().replace(/\s+/g, ' ');
  const match = cleaned.match(/^([A-Z]+)\s*(\d+[A-Z]?)$/);
  if (match) return `${match[1]} ${match[2]}`;
  return cleaned;
}

export function extractDepartment(code: string): string {
  const match = code.match(/^([A-Z]+)/);
  return match ? match[1] : '';
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function getTermDate(term: string): string {
  const yearMatch = term.match(/\d{4}/);
  const year = yearMatch ? yearMatch[0] : new Date().getFullYear().toString();
  if (/Fall/i.test(term)) return `${year}-09-01`;
  if (/Winter/i.test(term)) return `${year}-01-01`;
  if (/Spring/i.test(term) || /Summer/i.test(term)) return `${year}-05-01`;
  const now = new Date();
  return now.toISOString().split('T')[0];
}

function decodeTerm(termId: number): string {
  const str = termId.toString();
  if (str.length !== 4) return `Term ${termId}`;
  const year = parseInt("20" + str.substring(1, 3));
  const month = parseInt(str.substring(3));
  let season = "Unknown";
  if (month === 1) season = "Winter";
  else if (month === 5) season = "Spring";
  else if (month === 9) season = "Fall";
  return `${season} ${year}`;
}

async function fetchUrl(url: string, headers: Record<string, string> = {}): Promise<{ text: string; url: string; json?: any }> {
  const defaultHeaders = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'Cookie': process.env.WATERLOO_SESSION_COOKIE || ''
  };

  const response = await fetch(url, {
    headers: { ...defaultHeaders, ...headers },
    redirect: 'follow'
  });
  
  if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText} (${response.status})`);
  
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('json')) {
    return { text: '', url: response.url, json: await response.json() };
  }
  
  return { text: await response.text(), url: response.url };
}

// OpenAI Logic
async function parseWithOpenAI(htmlText: string): Promise<ParsedAssessment[]> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY in .env.local");
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const prompt = `
    You are a math-aware data extraction assistant.
    
    TASK: Extract the grading scheme from the course outline text below.
    
    CRITICAL INSTRUCTIONS:
    1. EXTRACT EVERY SINGLE ASSESSMENT ITEM. Look for tables, lists, or paragraphs describing "Evaluation", "Grading", "Marking Scheme".
    2. ENSURE TOTAL WEIGHT IS 100%. If you find items summing to less than 100%, LOOK HARDER for a "Final Exam", "Final Assessment", or "Midterm".
    3. IF A RANGE IS GIVEN (e.g. "Quizzes 1-5"), EXPAND IT into separate lines (Quiz 1, Quiz 2, ...).
    
    CRITICAL RULE FOR SHARED WEIGHTS (READ CAREFULLY):
    If a category (like "Weekly Assessments") has a total weight (e.g. 35%), and lists multiple types of items (e.g. 3 Assignments AND 8 Quizzes), you MUST:
    1. Count the TOTAL number of individual items in that category (3 + 8 = 11 items).
    2. Divide the category weight by that TOTAL count (35 / 11 = 3.1818). KEEP AT LEAST 4 DECIMAL PLACES.
    3. OUTPUT EVERY SINGLE ITEM INDIVIDUALLY.
       - "Assignment 1 – 3.1818 percent"
       - "Assignment 2 – 3.1818 percent"
       - ...
    
    DO NOT output grouped ranges like "Assignments 1-3". You MUST expand them into separate lines.
    
    DO NOT assign the full 35% to Assignments AND the full 35% to Quizzes. That makes the total 135%, which is IMPOSSIBLE. The total must be 100%.
    
    DO NOT set an item's weight to 0 unless it explicitly says "0%" or "not graded". If it's part of a group, it likely shares the weight.
    
    SANITY CHECK - MISSING WEIGHTS:
    If you list a sequence (e.g. Assignments 1-6), and most have a weight (e.g. 3.33%), but one is 0% (Assignment 6), AND the total course weight is under 100%, THIS IS LIKELY AN ERROR.
    Assume the 0% item has the SAME weight as its peers unless explicitly stated otherwise (e.g. "Practice only").
    
    FINAL SUM CHECK:
    If the total weight is NOT 100% (e.g. sums to 85% or 90%):
    1. Look for a "Participation" grade, "Quizzes", or check if the Final Exam weight is higher.
    2. RE-CALCULATE shared weights.
       - EXAMPLE: If "Assignments" = 20% and there are 5 assignments, EACH IS 4% (20/5).
       - DO NOT calculate 3.33% (which is 20/6) if only 5 are listed.
       - IF Midterm=30% and Final=50%, remaining is 20%. ALL Assignments share this 20%.
    
    If Assignments are listed as "best X of Y", calculate the weight based on X items.

    OUTPUT FORMAT:
    - Only plain text lines: "Name – Weight percent"
    - NO QUOTATION MARKS around names.
    - "Assignment 1 – 3.1818 percent"
    - "Quiz 1 – 3.1818 percent"
    ...

    Course Outline:
    ----------------
    ${htmlText.substring(0, 100000)} 
    ----------------
  `;

  const completion = await openai.chat.completions.create({
    messages: [{ role: "system", content: "You are a data extraction assistant." }, { role: "user", content: prompt }],
    model: "gpt-4o-mini", // Cost effective
  });

  const responseText = completion.choices[0].message.content || "";
  console.log("🤖 OpenAI Response Preview:\n", responseText.substring(0, 500));

  // Parse the plain text response back into objects
  const lines = responseText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const assessments: ParsedAssessment[] = [];
  const rawAssessments: ParsedAssessment[] = [];
  
  // Helper to track name counts for deduplication
  const nameCounts: Record<string, number> = {};

  for (const line of lines) {
    // Format: "Name – Weight percent"
    // Regex to capture Name and Weight
    const match = line.match(/^(.*?) [–-] (\d+(?:\.\d+)?) percent/);
    
    if (match) {
      let name = match[1].trim();
      // CLEANUP: Remove leading bullets, quotes, or hyphens if OpenAI gets messy
      // e.g. "- Quiz 1" -> "Quiz 1", " "Quiz 1"" -> "Quiz 1"
      name = name.replace(/^[\s*•"“'”-]+/, '').replace(/["“'”]\s*$/, '');
      
      // SECOND PASS: Specifically target any remaining leading quote if the above regex missed it
      if (name.startsWith('"') || name.startsWith('“') || name.startsWith("'") || name.startsWith('”')) {
          name = name.substring(1).trim();
      }

      const weight = parseFloat(match[2]);
      
      // Determine category based on name keywords
      let category = "Other";
      const lower = name.toLowerCase();
      if (lower.includes('assign')) category = "Assignment";
      else if (lower.includes('quiz')) category = "Quiz";
      else if (lower.includes('lab')) category = "Lab";
      else if (lower.includes('midterm')) category = "Midterm";
      else if (lower.includes('final')) category = "Final Exam";
      else if (lower.includes('clicker') || lower.includes('participation')) category = "Participation";
      else if (lower.includes('project')) category = "Project";

      // Handle duplicate names (e.g. "Assignment" appearing 10 times)
      // If name is generic (e.g. "Assignment"), append number
      if (!name.match(/\d/)) {
         nameCounts[name] = (nameCounts[name] || 0) + 1;
         // If we have seen this name before, or likely will (it's plural), number it
         // Check if the name is plural "Assignments" -> "Assignment 1"
         if (name.endsWith('s') || nameCounts[name] > 1) {
             // Convert "Assignments" -> "Assignment"
             // Handle special case for "Quizzes" -> "Quiz" (not "Quizze")
             let singular = name;
             if (name.toLowerCase().endsWith('quizzes')) {
                 singular = name.slice(0, -3); // Remove "zes" to get "Quiz" (actually wait, Quizz? No, Quiz)
                 // "Quizzes".slice(0, -3) -> "Quiz" (Index 0 to length-3: Q-u-i-z-z-e-s -> Q-u-i-z)
                 // Wait, "Quizzes" is 7 chars. slice(0, -3) is 4 chars. Q-u-i-z. Correct.
                 // Actually standard rule for words ending in 'zes' might be removing 'es' or 'zes'.
                 // Let's just do a specific replacement to be safe.
                 singular = name.replace(/quizzes$/i, 'Quiz');
             } else if (name.endsWith('s')) {
                singular = name.slice(0, -1);
             }
             
             name = `${singular} ${nameCounts[match[1].trim()]}`;
         }
      }

      rawAssessments.push({
        name: name,
        category: category,
        totalWeight: weight, // Since we split already, this is the individual weight
        count: 1,
        individualWeight: weight,
        assessmentType: category
      });
    }
  }
  
  // Filter out 0 weight items and Sort
  const filtered = rawAssessments.filter(a => a.totalWeight > 0);
  
  // Sort: Normal -> Midterm -> Final
  filtered.sort((a, b) => {
      const getScore = (name: string) => {
          const lower = name.toLowerCase();
          if (lower.includes('final') && (lower.includes('exam') || lower.includes('examination') || lower.includes('assessment'))) return 3;
          if (lower.includes('midterm')) return 2;
          return 1;
      };
      const scoreA = getScore(a.name);
      const scoreB = getScore(b.name);
      
      if (scoreA !== scoreB) return scoreA - scoreB;
      return 0; // Keep relative order
  });
  
  return filtered;
}

export async function parseCourseOutline(courseCode: string): Promise<ParsedCourse[]> {
  const normalizedCode = normalizeCourseCode(courseCode);
  const apiQuery = normalizedCode.replace(' ', '%20');
  const searchUrl = `https://outline.uwaterloo.ca/api/search?q=${apiQuery}`;
  
  console.log(`🔍 API Search: ${searchUrl}`);
  // Force JSON for API search
  const { json, text } = await fetchUrl(searchUrl, { 'Accept': 'application/json' });
  
  if (!json || !json.results || json.results.length === 0) {
    console.warn(`⚠️  API found 0 results for ${normalizedCode}`);
    if (text) {
        console.log('Response was text/html (likely auth redirect or error):', text.substring(0, 500));
    } else {
        console.log('Response was JSON but empty:', JSON.stringify(json, null, 2));
    }
    throw new Error('No outlines found');
  }
  
  const results = json.results as ApiSearchResult[];
  
  // 1. Find the latest term ID
  // Sort descending by term ID
  results.sort((a, b) => b.term - a.term);
  const latestTermId = results[0].term;
  
  // 2. Filter for ALL outlines from that latest term
  const latestOutlines = results.filter(r => r.term === latestTermId);
  const termName = decodeTerm(latestTermId);
  
  console.log(`📅 Latest Term Found: ${termName} (ID: ${latestTermId}) - Found ${latestOutlines.length} outlines`);
  
  const parsedCourses: ParsedCourse[] = [];

  // 3. Loop through each outline for the latest term
  for (const outlineMatch of latestOutlines) {
      console.log(`🔗 Fetching Outline: ${outlineMatch.url}`);
  
      const outlineFullUrl = `https://outline.uwaterloo.ca${outlineMatch.url}`;
  const { text: html } = await fetchUrl(outlineFullUrl);
  
  // Convert HTML to clean text for OpenAI
  const $ = cheerio.load(html);
  
  // Remove scripts, styles to reduce noise
  $('script, style, svg, nav, footer').remove();
  const cleanText = $('body').text().replace(/\s+/g, ' ').trim();
  
      console.log(`🤖 Sending ${cleanText.length} chars to OpenAI for ${outlineMatch.url}...`);
  
  const assessments = await parseWithOpenAI(cleanText);
  
  console.log(`📊 OpenAI found ${assessments.length} assessments`);
  
      // Attempt to extract section info if available in title, otherwise default
      // e.g. "MATH 137 - Calculus 1 (Section 001)"
      const title = outlineMatch.title || $('h1').first().text().trim() || courseCode;
  
      parsedCourses.push({
    code: normalizeCourseCode(courseCode),
        name: title,
    department: extractDepartment(courseCode),
    term: termName,
    termDate: getTermDate(termName),
    assessments,
    outlineUrl: outlineFullUrl
      });
  }

  return parsedCourses;
}
