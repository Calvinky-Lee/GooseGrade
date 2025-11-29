
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load .env.local
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface Assessment {
  id: string;
  name: string;
  weight: number;
  assessment_type: string;
  course_id: string;
}

function getStem(name: string): string {
  return name.toLowerCase()
    .replace(/\(.*\)/g, '') 
    .replace(/\s+\d+$/, '') 
    .replace(/\s+[a-z]\d+$/i, '') 
    .replace(/[^\w\s]/g, '') 
    .trim()
    .split(/\s+/) 
    .map(word => {
      if (word === 'quizzes') return 'quiz';
      if (word.endsWith('ies') && word.length > 3) return word.slice(0, -3) + 'y';
      if (word.endsWith('sses')) return word.slice(0, -2);
      if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) return word.slice(0, -1);
      return word;
    })
    .join(' ');
}

async function cleanDuplicates(courseCode?: string) {
  let query = supabase.from('courses').select('id, code');
  if (courseCode) query = query.ilike('code', `%${courseCode}%`);
  
  const { data: courses, error } = await query;
  if (error || !courses) {
    console.error('Error fetching courses:', error);
    return;
  }

  console.log(`Scanning ${courses.length} courses...`);

  for (const course of courses) {
    const { data: assessments } = await supabase
      .from('assessments')
      .select('*')
      .eq('course_id', course.id);

    if (!assessments || assessments.length === 0) continue;

    const toDelete: string[] = [];
    
    // 1. Fix "undefined" names
    const badNames = assessments.filter(a => a.name.includes('undefined'));
    for (const bad of badNames) {
       console.log(`[${course.code}] Deleting malformed name: "${bad.name}"`);
       toDelete.push(bad.id);
    }

    // 2. Exact Duplicates (Name + Weight)
    const exactGroups: { [key: string]: Assessment[] } = {};
    for (const a of assessments) {
       if (toDelete.includes(a.id)) continue;
       const key = `${a.name}|${a.weight}`;
       if (!exactGroups[key]) exactGroups[key] = [];
       exactGroups[key].push(a);
    }
    
    for (const group of Object.values(exactGroups)) {
       if (group.length > 1) {
          group.sort((a, b) => a.id.localeCompare(b.id));
          const remove = group.slice(1);
          for (const r of remove) {
             console.log(`[${course.code}] Deleting exact duplicate: "${r.name}"`);
             toDelete.push(r.id);
          }
       }
    }

    // 2.5 Total/Summary Row Detection (New)
    // If we have "X Total" and "X 1", delete "X Total".
    const remainingAfterExact = assessments.filter(a => !toDelete.includes(a.id));
    const potentialSummaries = remainingAfterExact.filter(a => /total|overall|sum/i.test(a.name));
    
    for (const summary of potentialSummaries) {
        // Remove "Total" word and stemming to match "Minor Assignment" from "Minor Assignments Total"
        const cleanName = summary.name.replace(/total|overall|sum/gi, '');
        const summaryStem = getStem(cleanName);
        
        // Check if we have specifics for this stem
        const specifics = remainingAfterExact.filter(a => 
            a.id !== summary.id && 
            getStem(a.name) === summaryStem &&
            /(\d+|[a-z]\d+)$/i.test(a.name.trim())
        );
        
        if (specifics.length > 0) {
             console.log(`[${course.code}] Deleting summary row: "${summary.name}" (Found ${specifics.length} specifics like "${specifics[0].name}")`);
             toDelete.push(summary.id);
        }
    }

    // 2.6 Fuzzy Name Match (Reordered Words) (New)
    // "Group Speech: Persuading" vs "Persuading ... (Group Speech)"
    const normalizeFuzzy = (name: string) => {
        return name.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).sort().join(' ');
    };
    
    const fuzzyGroups: { [key: string]: Assessment[] } = {};
    const remainingAfterSummary = assessments.filter(a => !toDelete.includes(a.id));
    
    for (const a of remainingAfterSummary) {
        const key = `${normalizeFuzzy(a.name)}|${a.weight}`;
        if (!fuzzyGroups[key]) fuzzyGroups[key] = [];
        fuzzyGroups[key].push(a);
    }
    
    for (const group of Object.values(fuzzyGroups)) {
       if (group.length > 1) {
          // Keep the one that looks "cleaner" (e.g. no parenthesis if possible, or shortest)
          group.sort((a, b) => a.name.length - b.name.length);
          const remove = group.slice(1);
          for (const r of remove) {
             console.log(`[${course.code}] Deleting fuzzy duplicate: "${r.name}"`);
             toDelete.push(r.id);
          }
       }
    }

    // 2.7 Token Subset Match (Same Weight)
    // "Short Speech Exercise 1" (subset) vs "90-Second Short Speech Exercise 1" (superset)
    const getTokens = (name: string) => name.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(t => t.length > 0);
    const remainingAfterFuzzy = assessments.filter(a => !toDelete.includes(a.id));
    
    for (const a of remainingAfterFuzzy) {
        if (toDelete.includes(a.id)) continue;
        const tokensA = new Set(getTokens(a.name));
        
        const superset = remainingAfterFuzzy.find(b => {
            if (b.id === a.id || toDelete.includes(b.id) || b.weight !== a.weight) return false;
            const tokensB = new Set(getTokens(b.name));
            if (tokensB.size <= tokensA.size) return false; // Must be strictly larger
            // Check if A is subset of B
            for (const t of tokensA) {
                if (!tokensB.has(t)) return false;
            }
            return true;
        });
        
        if (superset) {
            console.log(`[${course.code}] Deleting subset duplicate: "${a.name}" (Subset of "${superset.name}")`);
            toDelete.push(a.id);
        }
    }

    // 2.8 Common Token Ratio (Same Weight) (New)
    // "Scenario Question Response 1" vs "Scenario Question Submission 1"
    const remainingAfterSubset = assessments.filter(a => !toDelete.includes(a.id));
    for (let i = 0; i < remainingAfterSubset.length; i++) {
        const a = remainingAfterSubset[i];
        if (toDelete.includes(a.id)) continue;
        const tokensA = new Set(getTokens(a.name));
        
        for (let j = i + 1; j < remainingAfterSubset.length; j++) {
            const b = remainingAfterSubset[j];
            if (toDelete.includes(b.id) || b.weight !== a.weight) continue;
            
            const tokensB = new Set(getTokens(b.name));
            let shared = 0;
            for (const t of tokensA) { if (tokensB.has(t)) shared++; }
            
            const maxLen = Math.max(tokensA.size, tokensB.size);
            if (maxLen === 0) continue;
            
            const ratio = shared / maxLen;
            
            // Safety Checks
            if (ratio >= 0.80) { // Increased from 0.70
                // Check for number mismatch (Quiz 1 vs Quiz 2)
                const numsA = a.name.match(/\d+/g) || [];
                const numsB = b.name.match(/\d+/g) || [];
                if (numsA.join(',') !== numsB.join(',')) continue;
                
                // Critical Keyword Mismatch Check (e.g. Final vs Midterm)
                const nameA = a.name.toLowerCase();
                const nameB = b.name.toLowerCase();
                if (nameA.includes('midterm') && nameB.includes('final')) continue;
                if (nameA.includes('final') && nameB.includes('midterm')) continue;
                if (nameA.includes('project') && nameB.includes('assignment')) continue; // Maybe?

                console.log(`[${course.code}] Deleting similar duplicate: "${b.name}" (~"${a.name}", ratio ${ratio.toFixed(2)})`);
                toDelete.push(b.id);
            }
        }
    }

    // 3. Stem-based Specific vs Generic AND Naming Standardization
    const validAssessments = assessments.filter(a => !toDelete.includes(a.id));
    const groups: { [stem: string]: Assessment[] } = {};
    for (const a of validAssessments) {
       const stem = getStem(a.name);
       if (!stem) continue;
       if (!groups[stem]) groups[stem] = [];
       groups[stem].push(a);
    }

    for (const group of Object.values(groups)) {
       if (group.length <= 1) continue;
       const isSpecific = (name: string) => /(\d+|[a-z]\d+)$/i.test(name.trim());
       const specifics = group.filter(a => isSpecific(a.name));
       const generics = group.filter(a => !isSpecific(a.name));

       // Rule 3a: Delete Generics if Specifics exist
       if (specifics.length > 0 && generics.length > 0) {
          for (const gen of generics) {
             if (!toDelete.includes(gen.id)) {
                console.log(`[${course.code}] Deleting summary "${gen.name}" in favor of ${specifics.length} specifics`);
                toDelete.push(gen.id);
             }
          }
       }

       // Rule 3b: Standardize Naming (e.g. "Quizzes 1" -> "Quiz 1")
       if (specifics.length > 1) {
          const prefixes: {[p: string]: number} = {};
          for (const s of specifics) {
             const match = s.name.match(/^(.*?)(\d+)$/);
             if (match) {
                const p = match[1].trim();
                if (p) prefixes[p] = (prefixes[p] || 0) + 1;
             }
          }
          
          const sortedPrefixes = Object.entries(prefixes).sort((a,b) => b[1] - a[1]);
          if (sortedPrefixes.length > 1) {
             const dominant = sortedPrefixes[0][0];
             for (const s of specifics) {
                if (toDelete.includes(s.id)) continue;
                const match = s.name.match(/^(.*?)(\d+)$/);
                if (match) {
                   const p = match[1].trim();
                   const num = match[2];
                   if (p !== dominant) {
                      const newName = `${dominant} ${num}`;
                      console.log(`[${course.code}] Standardizing name: "${s.name}" -> "${newName}"`);
                      await supabase.from('assessments').update({ name: newName }).eq('id', s.id);
                   }
                }
             }
          }
       }
    }

    // Execute Deletions So Far
    if (toDelete.length > 0) {
      await supabase.from('assessments').delete().in('id', toDelete);
      console.log(`✅ Deleted ${toDelete.length} items from ${course.code}`);
    }

    // 5. Duplicate Name (Different Weight) Resolution - KNAPSACK SOLVER
    // Fetch fresh data
    const { data: current } = await supabase.from('assessments').select('*').eq('course_id', course.id);
    if (!current || current.length === 0) continue;

    const nameGroups: { [name: string]: Assessment[] } = {};
    for (const a of current) {
       if (!nameGroups[a.name]) nameGroups[a.name] = [];
       nameGroups[a.name].push(a);
    }

    const duplicateNames = Object.values(nameGroups).filter(list => list.length > 1);
    
    if (duplicateNames.length > 0) {
       const nonDuplicateSum = current
          .filter(a => nameGroups[a.name].length === 1)
          .reduce((sum, a) => sum + a.weight, 0);
       
       // Recursive Solver to find combination closest to 100%
       let bestDiff = Infinity;
       let bestCombination: Assessment[] = [];

       function solve(index: number, currentSelection: Assessment[]) {
          if (index === duplicateNames.length) {
             const currentSum = nonDuplicateSum + currentSelection.reduce((s, a) => s + a.weight, 0);
             const diff = Math.abs(currentSum - 100);
             if (diff < bestDiff) {
                bestDiff = diff;
                bestCombination = [...currentSelection];
             }
             return;
          }

          const candidates = duplicateNames[index];
          for (const candidate of candidates) {
             solve(index + 1, [...currentSelection, candidate]);
          }
       }

       if (duplicateNames.length <= 15) {
           solve(0, []);
           
           const toDeleteRound2: string[] = [];
           for (let i = 0; i < duplicateNames.length; i++) {
              const winner = bestCombination[i];
              const losers = duplicateNames[i].filter(a => a.id !== winner.id);
              for (const loser of losers) {
                 console.log(`[${course.code}] Deleting weight conflict: "${loser.name}" (${loser.weight}%) in favor of (${winner.weight}%)`);
                 toDeleteRound2.push(loser.id);
              }
           }

           if (toDeleteRound2.length > 0) {
              await supabase.from('assessments').delete().in('id', toDeleteRound2);
              console.log(`✅ Resolved ${toDeleteRound2.length} weight conflicts in ${course.code} (Error: ${bestDiff.toFixed(2)}%)`);
           }
       }
    }

    // 4. Orphan Renaming (Last step - refresh data again?)
    // Phase 5 might have deleted things.
    // We can run orphan renaming on `current` minus `toDeleteRound2`?
    // Or just refresh again. Safer.
    const { data: finalRemaining } = await supabase.from('assessments').select('*').eq('course_id', course.id);
    if (!finalRemaining) continue;
    
    for (const a of finalRemaining) {
       const match = a.name.match(/^(.*)\s+2$/);
       if (match) {
          const baseName = match[1];
          const siblings = finalRemaining.filter(r => 
             r.id !== a.id && 
             (r.name === baseName || r.name.startsWith(baseName))
          );
          
          if (siblings.length === 0) {
             console.log(`[${course.code}] Renaming orphan "${a.name}" -> "${baseName}"`);
             await supabase.from('assessments').update({ name: baseName }).eq('id', a.id);
          }
       }
    }
  }
}

cleanDuplicates(process.argv[2]);
