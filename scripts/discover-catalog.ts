import {config} from 'dotenv'; config({path:'.env.local'});
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import * as cheerio from 'cheerio';
import {selectedTerm,parseSchedule} from './import/schedule';
import {searchSubjectOutlines,pause} from './import/source';
import {termInfo} from '../lib/catalog/terms';
const get=(url:string)=>execFileSync('curl',['--fail','--silent','--show-error','--location','--retry','3','--max-time','45',url],{encoding:'utf8',maxBuffer:20*1024*1024});
async function main(){
 const term=selectedTerm(process.argv.slice(2)),dir=`.import-cache/${term}`,resume=process.argv.includes('--resume');
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const checkpoint=`${dir}/schedule.json`,schedules:Record<string,any>=resume&&fs.existsSync(checkpoint)?JSON.parse(fs.readFileSync(checkpoint,'utf8')):{};
 const tasks:{subject:string,level:string}[]=[];
 for(const level of ['under','grad']){
  const $=cheerio.load(get(`https://classes.uwaterloo.ca/${level}.html`));
  const subjects=$('select[name="subject"] option').map((_,e)=>$(e).attr('value')||$(e).text().trim()).get();
  if(!subjects.length)throw Error('Schedule subject index is empty.');
  for(const subject of subjects)tasks.push({subject,level});
 }
 for(const [i,{subject,level}] of tasks.entries()){
  const key=`${level}|${subject}`;
  if(!schedules[key]){
   const url=`https://classes.uwaterloo.ca/cgi-bin/cgiwrap/infocour/salook.pl?level=${level}&sess=${term}&subject=${subject}&cournum=`;
   schedules[key]=parseSchedule(get(url),term,subject,level,url);
   fs.writeFileSync(checkpoint,JSON.stringify(schedules,null,2),{mode:0o600});
   await pause(200);
  }
  if((i+1)%40===0)console.log(`Schedules ${i+1}/${tasks.length}`);
 }
 const map=new Map<string,any>();
 for(const rows of Object.values(schedules))for(const row of rows){const old=map.get(row.code);map.set(row.code,old?{...old,source_variants:[...new Set([...old.source_variants,...row.source_variants])]}:row);}
 const offerings=[...map.values()].sort((a,b)=>a.code.localeCompare(b.code));
 if(!offerings.length)throw Error('No offerings found.');
 fs.writeFileSync(`${dir}/offerings.json`,JSON.stringify(offerings,null,2),{mode:0o600});
 const file=`${dir}/discovery.json`,state:Record<string,any>=resume&&fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
 const subjects=[...new Set(offerings.map(o=>o.department))];
 for(const [i,subject] of subjects.entries()){
  const rows=offerings.filter(o=>o.department===subject);
  if(resume&&rows.every(o=>state[o.code]?.status==='complete'))continue;
  try{
   const outlines=await searchSubjectOutlines(subject,term,process.env.WATERLOO_SESSION_COOKIE||'');
   for(const row of rows)state[row.code]={status:'complete',checked_at:new Date().toISOString(),outlines:outlines.filter(o=>o.courses?.some(c=>`${c.subject} ${c.code}`===row.code))};
  }catch(e){for(const row of rows)state[row.code]={status:'error',message:e instanceof Error?e.message:String(e)};if(String(e).includes('Authentication'))throw e;}
  fs.writeFileSync(file,JSON.stringify(state,null,2),{mode:0o600});
  if((i+1)%10===0)console.log(`Outline subjects ${i+1}/${subjects.length}`);
  await pause(500);
 }
 const values=offerings.map(o=>state[o.code]);
 const summary={term,label:termInfo(term).label,offerings:offerings.length,subjects:subjects.length,checked:values.filter(s=>s?.status==='complete').length,withOutlines:values.filter(s=>s?.outlines?.length).length,sections:values.reduce((n,s)=>n+(s?.outlines?.length||0),0),errors:values.filter(s=>s?.status!=='complete').length};
 fs.writeFileSync(`${dir}/summary.json`,JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
 if(summary.errors)process.exitCode=1;
 else fs.writeFileSync("courses.txt",`# ${termInfo(term).label} (${term}) undergraduate and graduate offerings\n# Verified ${new Date().toISOString()}\n\n${offerings.map(o=>o.code).join("\n")}\n`);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
