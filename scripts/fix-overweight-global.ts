import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface Assessment {
  id: string;
  name: string;
  weight: number;
  course_id: string;
}

async function fixOverweightGlobal() {
  console.log('Fetching courses...');
  const { data: courses } = await supabase.from('courses').select('id, code');
  if (!courses) return;

  console.log(`Scanning ${courses.length} courses for weight issues...`);
  let fixedCount = 0;

  for (const course of courses) {
    const { data: assessments } = await supabase
      .from('assessments')
      .select('*')
      .eq('course_id', course.id);

    if (!assessments || assessments.length === 0) continue;

    let totalWeight = assessments.reduce((s, a) => s + a.weight, 0);
    if (totalWeight <= 100.1) continue;

    let excess = totalWeight - 100;
    // console.log(`[${course.code}] Excess: ${excess.toFixed(2)}% (Total: ${totalWeight.toFixed(2)}%)`);

    // Strategy 1: Check for Subset Sum (Container Components)
    // If a large item's weight equals sum of smaller items, delete the large item (container).
    // e.g. "Progress" (50) = "Effort" (10) + "Engagement" (10) + ...
    
    const sorted = [...assessments].sort((a, b) => b.weight - a.weight);
    const toDelete: string[] = [];
    
    for (let i = 0; i < sorted.length; i++) {
        const container = sorted[i];
        if (container.weight < 5) continue; // Don't bother with small stuff
        
        // Try to find subset of OTHER items that sum to container.weight
        const candidates = sorted.filter(a => a.id !== container.id && !toDelete.includes(a.id));
        
        // Simple greedy check for exact match? Or just checking if container.weight == excess?
        // If container.weight is exactly the excess, deleting it solves the problem!
        if (Math.abs(container.weight - excess) < 0.1) {
             // Check if name implies Summary
             if (/total|overall|progress|participation|lab/i.test(container.name)) {
                 console.log(`[${course.code}] Deleting likely summary/container: "${container.name}" (${container.weight}%) matches excess.`);
                 toDelete.push(container.id);
                 excess -= container.weight;
                 break; 
             }
        }
    }

    if (toDelete.length > 0) {
        await supabase.from('assessments').delete().in('id', toDelete);
        // Re-calc excess
        totalWeight -= toDelete.reduce((s, id) => s + (assessments.find(a => a.id === id)?.weight || 0), 0);
        excess = totalWeight - 100;
    }

    if (excess <= 0.5) {
        fixedCount++;
        continue;
    }

    // Strategy 2: Best N of M (Multiple of Weight)
    // If Excess is multiple of W, and we have items of weight W.
    const byWeight: { [w: number]: Assessment[] } = {};
    // Re-fetch or filter deleted
    const remaining = assessments.filter(a => !toDelete.includes(a.id));
    remaining.forEach(a => {
        if (!byWeight[a.weight]) byWeight[a.weight] = [];
        byWeight[a.weight].push(a);
    });

    for (const [wStr, items] of Object.entries(byWeight)) {
        const w = parseFloat(wStr);
        if (w <= 0) continue;
        
        const ratio = excess / w;
        const rounded = Math.round(ratio);
        
        // If Excess is approx integer multiple of W (e.g. 1*W, 2*W)
        // And we have more items than that (so we don't delete everything)
        if (Math.abs(excess - rounded * w) < 0.1 && rounded > 0 && items.length > rounded) {
             const keepCount = items.length - rounded;
             console.log(`[${course.code}] Detected "Best ${keepCount} of ${items.length}" for weight ${w}%. Excess ${excess.toFixed(2)}% ~= ${rounded} * ${w}.`);
             
             const newWeight = w * keepCount / items.length;
             console.log(`   -> Adjusting ${items.length} items to ${newWeight.toFixed(2)}% each.`);
             
             for (const item of items) {
                 await supabase.from('assessments').update({ weight: newWeight }).eq('id', item.id);
             }
             
             excess -= rounded * w;
             if (excess < 0.5) break;
        }
    }
    
    if (totalWeight - excess <= 100.5) fixedCount++;
  }
  
  console.log(`\nProcessed. Fixed approx ${fixedCount} courses.`);
}

fixOverweightGlobal();


