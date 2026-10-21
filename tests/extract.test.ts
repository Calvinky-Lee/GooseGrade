import { test } from "node:test";
import assert from "node:assert/strict";
import { extractTable } from "../scripts/import/extract";
test("exam pass gates prevent automatic fixed-scheme publication", () => {
  const html =
    "<body><table><tr><td>Assignments</td><td>50%</td></tr><tr><td>Final</td><td>50%</td></tr></table><p>You must earn at least 50% on the final exam to pass the course.</p></body>";
  assert.equal(extractTable(html), null);
});
test('official multi-column assessment tables use the weight column', () => {
 const html='<body><table><tr><th>Component / Activity</th><th>Date</th><th>Location</th><th>Weight (%)</th></tr><tr><td>Essay</td><td>October 10</td><td>LEARN</td><td>40%</td></tr><tr><td>Exam</td><td>TBD</td><td>In person</td><td>60%</td></tr></table></body>';
 assert.deepEqual(extractTable(html)?.assessments.map(a=>a.weight),[40,60]);
});
test('scripts cannot be mistaken for conditional grading policy',()=>{
 const html='<body><table><tr><td>Essay</td><td>40%</td></tr><tr><td>Exam</td><td>60%</td></tr></table><script>text.replace("something", "another")</script></body>';
 assert.equal(extractTable(html)?.assessments.length,2);
});
test('numeric weights are accepted only under an explicit percentage header',()=>{
 const table=(header:string)=>`<body><table><tr><th>Component</th><th>Date</th><th>${header}</th></tr><tr><td>Essay</td><td>Oct 10</td><td>40</td></tr><tr><td>Exam</td><td>TBD</td><td>60 points</td></tr></table></body>`;
 assert.deepEqual(extractTable(table('Weight (%)'))?.assessments.map(a=>a.weight),[40,60]);
 assert.equal(extractTable(table('Points')),null);
});
test('exam-average cases cannot publish the first of two grading formulas',()=>{
 const html='<body><h2>Case 1 - If average exam grade ≥ 50%</h2><table><tr><td>Work</td><td>30%</td></tr><tr><td>Exams</td><td>70%</td></tr></table><h2>Case 2 - If average exam grade &lt; 50%</h2><table><tr><td>Exams</td><td>100%</td></tr></table></body>';
 assert.equal(extractTable(html),null);
});
import { gradingText } from '../scripts/import/extract';
test('external extraction receives grading sections, not instructor or university sections',()=>{
 const html='<body><article><h2 id="instructional_team">Team</h2><p>Private Instructor Details</p><h2 id="assessments_amp_activities">Assessments</h2><p>Essay 40%, Exam 60%</p><h2 id="administrative_policy">Policy</h2><p>Exam pass threshold 50%</p><h3 id="university_policy">University</h3><p>Other text</p></article></body>';
 const text=gradingText(html);assert.ok(text.includes('Essay 40%'));assert.ok(text.includes('pass threshold'));assert.ok(!text.includes('Private Instructor'));assert.ok(!text.includes('Other text'));
});
