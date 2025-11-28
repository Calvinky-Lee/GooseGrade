import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load env vars
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  // We don't throw immediately to allow scripts to run help commands without env vars
  console.warn('⚠️  Missing Supabase environment variables. Check .env.local');
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

