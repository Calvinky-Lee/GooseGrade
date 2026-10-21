import * as cheerio from 'cheerio';
import { DEFAULT_TERM, termInfo } from '../../lib/catalog/terms';
export function selectedTerm(args: string[]) {
 const arg=args.find(x=>x.startsWith('--term='));
 const term=arg?Number(arg.split('=')[1]):DEFAULT_TERM;
 termInfo(term); return term;
}
export function parseSchedule(html: string, term: number, subject: string, level: string, url: string) {
 const $=cheerio.load(html),text=$('body').text().replace(/\s+/g,' '),info=termInfo(term);
 if(!text.includes(`Term: ${term}`)||!text.includes(`Subject: ${subject}`)) throw Error('Schedule source does not confirm requested term and subject.');
 const rows=new Map<string,any>();
 $('tr').each((_,tr)=>{
  const cells=$(tr).children('td');
  if(cells.length!==4) return;
  const s=$(cells[0]).text().trim(),n=$(cells[1]).text().trim();
  if(s!==subject||!/^\d+[A-Z]*$/.test(n))return;
  const code=`${s} ${n}`;
  rows.set(code,{code,name:$(cells[3]).text().trim()||code,department:s,term_id:term,term:info.label,term_date:info.date,source_url:url,source_variants:[level],fetched_at:new Date().toISOString()});
 });
 return [...rows.values()];
}
