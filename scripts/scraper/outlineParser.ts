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

async function fetchUrl(url: string): Promise<{ text: string; url: string; json?: any }> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': process.env.SCRAPER_USER_AGENT || 'Mozilla/5.0',
      'Cookie': process.env.WATERLOO_SESSION_COOKIE || '',
      'Accept': 'application/json, text/html'
    },
    redirect: 'follow'
  });
  
  if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);
  
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
    You are a precise data extraction assistant.
    I will provide the text content of a university course outline.
    
    Your job is to:
    1. Extract the grading / assessment scheme.
    2. Infer the number of items within each assessment category (e.g. how many assignments, quizzes, labs).
    3. Compute per item weights when necessary.
    4. Output a clean, human readable breakdown of all graded assessments.

    Output format:
    - Produce ONLY plain text lines.
    - Do NOT return JSON, code fences, explanations, or commentary.
    - Each graded assessment must be on its own line, using this exact format:
      <Assessment name> – <weight> percent
    
    Core rules for extraction and inference:
    1. Identify assessment categories like Assignments, Labs, Quizzes, Midterms, Finals.
    2. Interpret "20 points" as "20 percent".
    3. Determine counts: 
       - If calendar lists A01..A10, then count is 10.
       - If "Best 5 of 6", count is 5.
    4. Splitting weights:
       - If "Assignments - 20%" and there are 10 assignments, output 10 lines each worth 2%.
    5. Naming:
       - Use explicit names if present (e.g. "Assignment A01").
       - Otherwise use indexes (e.g. "Quiz 1", "Quiz 2").
    6. Omit items worth 0%.
    7. Ignore "Total" rows.
    8. If the course is graded on a Pass/Fail (CR/NCR) basis with no percentage weights, return an empty list.
    9. If you absolutely cannot find a grading scheme, return an empty list. Do not invent one.

    Here is the course outline text:
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
  
  // Helper to track name counts for deduplication
  const nameCounts: Record<string, number> = {};

  for (const line of lines) {
    // Format: "Name – Weight percent"
    // Regex to capture Name and Weight
    const match = line.match(/^(.*?) [–-] (\d+(?:\.\d+)?) percent/);
    
    if (match) {
      let name = match[1].trim();
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
             const singular = name.endsWith('s') ? name.slice(0, -1) : name;
             name = `${singular} ${nameCounts[match[1].trim()]}`;
         }
      }

      assessments.push({
        name: name,
        category: category,
        totalWeight: weight, // Since we split already, this is the individual weight
        count: 1,
        individualWeight: weight,
        assessmentType: category
      });
    }
  }
  
  return assessments;
}

export async function parseCourseOutline(courseCode: string): Promise<ParsedCourse> {
  const normalizedCode = normalizeCourseCode(courseCode);
  const apiQuery = normalizedCode.replace(' ', '%20');
  const searchUrl = `https://outline.uwaterloo.ca/api/search?q=${apiQuery}`;
  
  console.log(`🔍 API Search: ${searchUrl}`);
  const { json } = await fetchUrl(searchUrl);
  
  if (!json || !json.results || json.results.length === 0) {
    console.warn(`⚠️  API found 0 results for ${normalizedCode}`);
    throw new Error('No outlines found');
  }
  
  const results = json.results as ApiSearchResult[];
  results.sort((a, b) => b.term - a.term);
  
  const bestMatch = results[0];
  const termName = decodeTerm(bestMatch.term);
  
  console.log(`📅 Latest Term Found: ${termName} (ID: ${bestMatch.term})`);
  console.log(`🔗 Fetching Outline: ${bestMatch.url}`);
  
  const outlineFullUrl = `https://outline.uwaterloo.ca${bestMatch.url}`;
  const { text: html } = await fetchUrl(outlineFullUrl);
  
  // Convert HTML to clean text for OpenAI
  const $ = cheerio.load(html);
  
  // Remove scripts, styles to reduce noise
  $('script, style, svg, nav, footer').remove();
  const cleanText = $('body').text().replace(/\s+/g, ' ').trim();
  
  console.log(`🤖 Sending ${cleanText.length} chars to OpenAI...`);
  
  const assessments = await parseWithOpenAI(cleanText);
  
  console.log(`📊 OpenAI found ${assessments.length} assessments`);
  
  const courseName = bestMatch.title || $('h1').first().text().trim() || courseCode;
  
  return {
    code: normalizeCourseCode(courseCode),
    name: courseName,
    department: extractDepartment(courseCode),
    term: termName,
    termDate: getTermDate(termName),
    assessments,
    outlineUrl: outlineFullUrl
  };
}
