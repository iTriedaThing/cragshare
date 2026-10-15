import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {compute,removeParticipant} from './engine.mjs';
const trip=JSON.parse(fs.readFileSync(new URL('./acadia-sample.json',import.meta.url),'utf8'));
test('Acadia source totals and reconciliation',()=>{const r=compute(trip);assert.equal(r.totalCents,54575);assert.equal(r.errors.length,0);assert.equal(r.balances.reduce((a,b)=>a+b.netCents,0),0);});
test('category inclusions match workbook',()=>{const r=compute(trip);let b=Object.fromEntries(r.balances.map(b=>[b.name,b]));assert.equal(b.Katia.shareCents,3315);assert.equal(b.Mike.byCategory['shared-alcohol']||0,0);assert.equal(b.Elise.byCategory['shared-alcohol']||0,0);assert.equal(b.Rohit.paidCents,6900);assert.equal(b.Ted.paidCents,11675);});
test('each allocation conserves cents',()=>{const r=compute(trip);for(const a of r.allocations)assert.equal(a.amountCents,a.allocations.reduce((s,p)=>s+p.amountCents,0));});
test('custom overrides and attendance',()=>{const t=structuredClone(trip);t.people.forEach(p=>p.days=['2026-07-20']);t.people[0].days=['2026-07-21'];t.categories[0].useAttendance=true;t.expenses[0].benefitDate='2026-07-20';let r=compute(t);assert(!r.allocations[0].eligibleIds.includes('rohit'));t.expenses[0].participantIds=['rohit','ben'];r=compute(t);assert.deepEqual(r.allocations[0].eligibleIds,['rohit','ben']);});

test('attendance default includes participants on dated expenses and reflects the UI',()=>{
  const t=structuredClone(trip);
  t.categories[0].useAttendance=true;
  t.expenses[0].benefitDate='2026-07-20';
  // All original participants have no days field: they attend every day by default.
  const r=compute(t);
  assert.deepEqual(r.allocations[0].eligibleIds,t.people.map(p=>p.id));
  assert.equal(r.allocations[0].allocations.reduce((a,b)=>a+b.amountCents,0),6500);
  assert.equal(r.errors.length,0);
});

test('attendance [] means explicitly no dates; selected dates narrow the group',()=>{
  const t=structuredClone(trip);
  t.categories[0].useAttendance=true;
  t.expenses[0].benefitDate='2026-07-20';
  t.people[0].days=[];
  t.people[1].days=['2026-07-19'];
  t.people[2].days=['2026-07-20'];
  const r=compute(t);
  assert(!r.allocations[0].eligibleIds.includes('rohit'));
  assert(!r.allocations[0].eligibleIds.includes('ben'));
  assert(r.allocations[0].eligibleIds.includes('ted'));
  assert(r.allocations[0].eligibleIds.includes('katia'));
  assert.equal(r.errors.length,0);
  // Reset-to-default removes the property and restores all-day inclusion.
  delete t.people[0].days;
  assert(compute(t).allocations[0].eligibleIds.includes('rohit'));
});

test('attendance applies only to categories configured for it and explicit overrides win',()=>{
  const t=structuredClone(trip);
  t.expenses[0].benefitDate='2026-07-20';
  t.people[0].days=[];
  // Attendance disabled in category: still included.
  assert(compute(t).allocations[0].eligibleIds.includes('rohit'));
  t.categories[0].useAttendance=true;
  assert(!compute(t).allocations[0].eligibleIds.includes('rohit'));
  t.expenses[0].participantIds=['rohit','ben'];
  assert.deepEqual(compute(t).allocations[0].eligibleIds,['rohit','ben']);
});


test('removing a non-payer deletes all membership references and recalculates cents',()=>{
  const t=structuredClone(trip);
  t.categories[0].excludedIds.push('katia');
  t.expenses[0].participantIds=['ben','katia'];
  t.paidTransfers=['old:marker'];
  const updated=removeParticipant(t,'katia');
  assert.equal(t.people.length,11,'does not mutate source');
  assert.equal(updated.people.length,10);
  assert(!updated.categories[0].excludedIds.includes('katia'));
  assert.deepEqual(updated.expenses[0].participantIds,['ben']);
  assert.deepEqual(updated.paidTransfers,[]);
  assert.equal(compute(updated).totalCents,54575);
  assert.equal(compute(updated).errors.length,0);
});

test('payer removal requires reassignment first',()=>{
  assert.throws(()=>removeParticipant(trip,'ben'),/paid for 1 expense/);
});

test('participant removal refuses to leave a custom expense with no eligible people',()=>{
  const t=structuredClone(trip);
  t.expenses[0].participantIds=['katia'];
  assert.throws(()=>removeParticipant(t,'katia'),/No one is set to share/);
});

// Version 0.1.2: day boundaries are verified in the engine, not only in a browser input.
test('all-trip-days means only days inside the trip, never arbitrary dates', async () => {
  const {eligiblePeople,attendsOn,benefitDayError} = await import('./engine.mjs');
  const t=structuredClone(trip);
  const person=t.people[0]; // no .days field, so attends all TRIP days
  assert.equal(attendsOn(person,'2026-07-20',t),true);
  assert.equal(attendsOn(person,'2026-07-25',t),false);
  assert.match(benefitDayError(t,'2026-07-25'),/outside the trip/);
  t.categories[0].useAttendance=true;
  const e={...t.expenses[0],benefitDate:'2026-07-25'};
  assert.deepEqual(eligiblePeople(t,e),[]);
  t.expenses[0]=e;
  const result=compute(t);
  assert(result.errors.some(x=>x.includes('outside the trip')));
  assert(!result.reconciled);
  assert(!result.allocations.some(x=>x.expenseId===e.id));
});

test('out-of-trip day is rejected even for a category not using trip days or manual overrides',()=>{
  const t=structuredClone(trip);
  t.categories[0].useAttendance=false;
  t.expenses[0].benefitDate='2026-07-18';
  t.expenses[0].participantIds=t.people.map(p=>p.id);
  const r=compute(t);
  assert(r.errors.some(x=>x.includes('outside the trip')));
  assert(!r.allocations.some(x=>x.expenseId===t.expenses[0].id));
});

test('an invalid calendar date, or a chosen day without valid trip dates, is rejected',async()=>{
  const {benefitDayError} = await import('./engine.mjs');
  assert.match(benefitDayError(trip,'2026-02-30'),/valid day/);
  assert.match(benefitDayError({...trip,startDate:''},'2026-07-20'),/Set the trip start/);
  assert.match(benefitDayError({...trip,startDate:'2026-07-22',endDate:'2026-07-20'},'2026-07-20'),/Set the trip start/);
  assert.equal(benefitDayError(trip,''),null);
  assert.equal(benefitDayError(trip,'2026-07-20'),null);
});

test('missing day is allowed but clearly warns when trip days are used',()=>{
  const t=structuredClone(trip);
  t.categories[0].useAttendance=true;
  t.people[0].days=[];
  t.expenses[0].benefitDate='';
  const r=compute(t);
  assert.equal(r.errors.length,0);
  assert(r.warnings.some(x=>x.includes(t.expenses[0].title)&&x.includes('no day chosen')));
  assert(r.allocations[0].eligibleIds.includes(t.people[0].id));
  // Manual participant picks are explicit and should not be shown the warning.
  t.expenses[0].participantIds=['ben'];
  assert(!compute(t).warnings.some(x=>x.includes(t.expenses[0].title)));
});

test('fixing an out-of-trip day restores complete balances and settlements',()=>{
  const t=structuredClone(trip);
  t.categories[0].useAttendance=true;
  t.expenses[0].benefitDate='2026-07-25';
  const invalid=compute(t);
  assert.equal(invalid.reconciled,false);
  t.expenses[0].benefitDate='2026-07-20';
  const fixed=compute(t);
  assert.equal(fixed.reconciled,true);
  assert.equal(fixed.errors.length,0);
  assert.equal(fixed.totalCents,54575);
  assert.equal(fixed.balances.reduce((s,b)=>s+b.netCents,0),0);
});
