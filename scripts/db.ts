
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load env vars
const envPath = path.resolve(__dirname, '../.env.local');
dotenv.config({ path: envPath });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn(`⚠️  Missing Supabase env vars. Tried loading from: ${envPath}`);
  console.warn(`Keys found: ${Object.keys(process.env).filter(k => k.includes('SUPABASE'))}`);
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey || 'placeholder', {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

export interface Course {
  id?: string;
  code: string;
  name: string;
  department?: string;
  term: string;
  term_date: string; // YYYY-MM-DD
  outline_url?: string;
  last_scraped?: Date;
}

export interface Assessment {
  id?: string;
  course_id: string;
  course_code: string; // Redundant but requested
  name: string;
  category?: string;
  weight: number;
  total_weight: number;
  assessment_type: string;
  order_index: number;
  term: string;
  term_date: string;
}
