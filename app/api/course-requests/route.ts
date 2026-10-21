import {createClient} from '@supabase/supabase-js';
import {handleCourseRequest} from '@/lib/course-requests/handler';
export async function POST(request:Request){
 return handleCourseRequest(request,async row=>{
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if(!url||!key)throw Error('Request storage unavailable');
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {error}=await db.from('course_requests').insert(row);
  // One queue entry per course/term. An existing request is already awaiting review.
  if(error&&error.code!=='23505')throw error;
 });
}
