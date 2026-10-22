import {test} from 'node:test';
import assert from 'node:assert/strict';
import { handleCourseRequest } from '../lib/course-requests/handler';
const request=(body:unknown)=>new Request('https://goosegrade.vercel.app/api/course-requests',{method:'POST',headers:{'content-type':'application/json',origin:'https://goosegrade.vercel.app'},body:JSON.stringify(body)});
test('missing-course requests normalize codes and save only allowed fields',async()=>{
 let saved:any;
 const result=await handleCourseRequest(request({code:' cs135 ',outlineUrl:'https://outline.uwaterloo.ca/viewer/view/example',notes:' Missing section ',status:'approved'}),async row=>{saved=row;});
 assert.equal(result.status,201);assert.equal(saved.course_code,'CS 135');assert.equal(saved.term_id,1269);assert.equal(saved.notes,'Missing section');assert.equal(saved.status,undefined);
});
test('invalid or cross-origin submissions never reach storage',async()=>{
 let saves=0;const save=async()=>{saves++;};
 assert.equal((await handleCourseRequest(request({code:'bad'}),save)).status,400);
 assert.equal((await handleCourseRequest(request({code:'CS 135',outlineUrl:'javascript:alert(1)'}),save)).status,400);
 assert.equal((await handleCourseRequest(new Request('https://goosegrade.vercel.app/api/course-requests',{method:'POST',headers:{origin:'https://other.example'},body:'{}'}),save)).status,403);
 assert.equal(saves,0);
});
test('storage errors do not report success or expose database details',async()=>{
 const result=await handleCourseRequest(request({code:'MATH 135'}),async()=>{throw Error('private database detail');});
 assert.equal(result.status,503);assert.ok(!(await result.text()).includes('private database'));
});
test('same-origin requests work behind Next host rewriting',async()=>{
 const r=new Request('http://localhost:3108/api/course-requests',{method:'POST',headers:{host:'127.0.0.1:3108',origin:'http://127.0.0.1:3108'},body:JSON.stringify({code:'CS 135'})});
 assert.equal((await handleCourseRequest(r,async()=>{})).status,201);
});
