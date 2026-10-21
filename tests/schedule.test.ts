import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSchedule, selectedTerm } from '../scripts/import/schedule';
import { searchSubjectOutlines } from '../scripts/import/source';
test('Fall is default; explicit terms validate before work', () => {
  assert.equal(selectedTerm([]),1269);
  assert.equal(selectedTerm(['--term=1271']),1271);
  assert.throws(()=>selectedTerm(['--term=1262']));
});
test('schedule parses titles rather than units and ignores nested section rows', () => {
 const html='<body>Level: Undergraduate , Term: 1269 , Subject: CS , Course Number: <table><tr><td>CS</td><td>135</td><td>0.5</td><td>Designing Programs</td></tr><tr><td></td><td colspan="3"><table><tr><td>12345</td><td>LEC 001</td></tr></table></td></tr></table></body>';
 const rows=parseSchedule(html,1269,'CS','under','https://classes.uwaterloo.ca/example');
 assert.equal(rows.length,1);assert.equal(rows[0].name,'Designing Programs');assert.equal(rows[0].term,'Fall 2026');
 assert.throws(()=>parseSchedule(html,1271,'CS','under','url'));
 assert.throws(()=>parseSchedule('<body>Server unavailable</body>',1269,'CS','under','url'));
});
test('viewer subject search handles string terms and crosslisted courses',async()=>{
 const r=await searchSubjectOutlines('CS',1269,'',async()=>new Response(JSON.stringify([
 {term:'1269',courses:'CS 439, ECE 455',url:'/viewer/view/example'},
 {term:'1261',courses:'CS 135',url:'/viewer/view/old'},
 {term:'1269',courses:'CS 100',url:null}
 ]),{headers:{'content-type':'application/json'}}));
 assert.equal(r.length,1);assert.equal(r[0].term,1269);assert.equal(r[0].courses?.[1].subject,'ECE');
});
