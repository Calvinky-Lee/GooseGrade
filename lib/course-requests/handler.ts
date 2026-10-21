import {z} from 'zod';
import {normalizeCode, DEFAULT_TERM} from '../catalog/terms';
const schema=z.object({
 code:z.string().max(30).transform(normalizeCode).pipe(z.string().regex(/^[A-Z]{2,10} \d{2,4}[A-Z]{0,2}$/)),
 outlineUrl:z.string().trim().max(1000).optional().default('').refine(value=>{
  if(!value)return true;
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&(url.hostname==='uwaterloo.ca'||url.hostname.endsWith('.uwaterloo.ca'));}catch{return false;}
 }),
 notes:z.string().trim().max(1000).optional().default(''),
});
export type CourseRequest={course_code:string;term_id:number;outline_url:string|null;notes:string};
export async function handleCourseRequest(request:Request,save:(row:CourseRequest)=>Promise<void>){
 const origin=request.headers.get('origin');
 if(origin){
  let sameOrigin=false;
  try{const url=new URL(origin);sameOrigin=['http:','https:'].includes(url.protocol)&&url.host===(request.headers.get('host')||new URL(request.url).host);}catch{}
  if(!sameOrigin)return Response.json({error:'Please submit this form from GooseGrade.'},{status:403});
 }
 let parsed;
 try{const text=await request.text();if(text.length>5000)throw Error();parsed=schema.safeParse(JSON.parse(text));}catch{return Response.json({error:'Please check your request and try again.'},{status:400});}
 if(!parsed.success)return Response.json({error:'Enter a course code such as CS 135 and, if included, a valid Waterloo HTTPS outline link. Keep notes under 1,000 characters.'},{status:400});
 try{
  await save({course_code:parsed.data.code,term_id:DEFAULT_TERM,outline_url:parsed.data.outlineUrl||null,notes:parsed.data.notes});
  return Response.json({ok:true},{status:201});
 }catch{return Response.json({error:'Your request could not be saved. Please try again shortly.'},{status:503});}
}
