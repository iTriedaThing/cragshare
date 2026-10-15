// Pure, deterministic financial engine. Money is always stored as integer cents.
export const cents = value => Math.round(Number(value || 0) * 100);
export const dollars = value => (value / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
export const uid = () => crypto.randomUUID();

// The benefit date belongs to the trip, not the purchase date. Date strings
// are stored as local YYYY-MM-DD values and compared without time zones.
export function validDay(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const parsed = new Date(`${day}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
}

export function benefitDayError(trip, day) {
  if (!day) return null; // Costs without a day use their category's full group.
  if (!validDay(day)) return 'Choose a valid day for this cost.';
  if (!validDay(trip.startDate) || !validDay(trip.endDate) || trip.startDate > trip.endDate) {
    return 'Set the trip start and end dates before choosing a day for this cost.';
  }
  if (day < trip.startDate || day > trip.endDate) {
    return `The day for this cost (${day}) is outside the trip (${trip.startDate} to ${trip.endDate}).`;
  }
  return null;
}

// Missing/null days means all days *within this trip*, never any arbitrary day.
// [] means none, and an array of dates restricts attendance to those dates.
export function attendsOn(person, benefitDate, trip) {
  if (!benefitDate) return true;
  if (benefitDayError(trip, benefitDate)) return false;
  return !Array.isArray(person.days) || person.days.includes(benefitDate);
}

// Use the same eligibility rule in both the calculation engine and the UI.
export function eligiblePeople(trip, expense) {
  const people = trip.people || [];
  if (benefitDayError(trip, expense.benefitDate)) return [];
  if (Array.isArray(expense.participantIds)) {
    return people.filter(p => expense.participantIds.includes(p.id));
  }
  const category = (trip.categories || []).find(c => c.id === expense.categoryId);
  if (!category) return [];
  return people.filter(p => !(category.excludedIds || []).includes(p.id)
    && (!category.useAttendance || attendsOn(p, expense.benefitDate, trip)));
}

export function compute(trip) {
  const people = trip.people || [];
  const categories = trip.categories || [];
  const shares = Object.fromEntries(people.map(p => [p.id, 0]));
  const paid = Object.fromEntries(people.map(p => [p.id, 0]));
  const owedByCategory = Object.fromEntries(people.map(p => [p.id, {}]));
  const gross = Object.fromEntries(people.map(p => [p.id, Object.fromEntries(people.map(q => [q.id, 0]))]));
  let total = 0;
  const allocations = [];
  const errors = [];
  const warnings = [];
  for (const e of trip.expenses || []) {
    const amount = Number(e.amountCents);
    if (!Number.isSafeInteger(amount) || amount <= 0) { errors.push(`“${e.title}”: Enter an amount above $0.`); continue; }
    if (!(e.payerId in paid)) { errors.push(`“${e.title}”: Choose who paid.`); continue; }
    const category = categories.find(c => c.id === e.categoryId);
    if (!category) { errors.push(`“${e.title}”: Choose a category.`); continue; }
    const dayError = benefitDayError(trip, e.benefitDate);
    if (dayError) { errors.push(`“${e.title}”: ${dayError} Edit the cost to fix it.`); continue; }
    if (category.useAttendance && !e.benefitDate && !Array.isArray(e.participantIds)) {
      warnings.push(`“${e.title}” has no day chosen. Everyone included in ${category.name} shares it, even people marked as attending no days.`);
    }
    const eligible = eligiblePeople(trip, e);
    if (!eligible.length) { errors.push(`“${e.title}”: No one is set to share this cost. Check the category or choose who should pay.`); continue; }
    const base = Math.floor(amount / eligible.length);
    const remainder = amount % eligible.length;
    const allocationsForExpense = [];
    eligible.forEach((p, i) => {
      const share = base + (i < remainder ? 1 : 0);
      shares[p.id] += share;
      owedByCategory[p.id][category.id] = (owedByCategory[p.id][category.id] || 0) + share;
      if (p.id !== e.payerId) gross[p.id][e.payerId] += share;
      allocationsForExpense.push({ personId: p.id, amountCents: share });
    });
    paid[e.payerId] += amount;
    total += amount;
    allocations.push({ expenseId: e.id, title: e.title, amountCents: amount, eligibleIds: eligible.map(p=>p.id), allocations: allocationsForExpense });
  }
  const balances = people.map(p => ({...p, paidCents: paid[p.id], shareCents: shares[p.id], netCents: paid[p.id] - shares[p.id], byCategory: owedByCategory[p.id]}));
  const sumNet = balances.reduce((s,b) => s+b.netCents, 0);
  if (sumNet !== 0) errors.push(`Balances do not reconcile: ${sumNet} cents`);
  const pairwise = [];
  for (let i=0;i<people.length;i++) for(let j=i+1;j<people.length;j++) {
    const a=people[i], b=people[j], delta=gross[a.id][b.id]-gross[b.id][a.id];
    if (delta>0) pairwise.push({from:a.id,to:b.id,amountCents:delta});
    if (delta<0) pairwise.push({from:b.id,to:a.id,amountCents:-delta});
  }
  const payers = balances.filter(b=>b.netCents<0).map(b=>({...b,remaining:-b.netCents})).sort((a,b)=>b.remaining-a.remaining);
  const receivers = balances.filter(b=>b.netCents>0).map(b=>({...b,remaining:b.netCents})).sort((a,b)=>b.remaining-a.remaining);
  const compact = [];
  let i=0,j=0;
  while(i<payers.length && j<receivers.length){
    const n=Math.min(payers[i].remaining,receivers[j].remaining);
    if(n>0)compact.push({from:payers[i].id,to:receivers[j].id,amountCents:n});
    payers[i].remaining-=n; receivers[j].remaining-=n;
    if(!payers[i].remaining)i++;
    if(!receivers[j].remaining)j++;
  }
  const verify = payments => {
    const results = Object.fromEntries(people.map(p=>[p.id,0]));
    for(const t of payments){ results[t.from]-=t.amountCents; results[t.to]+=t.amountCents; }
    return balances.every(b=>results[b.id]===b.netCents);
  };
  if (!verify(pairwise)) errors.push('Pairwise settlement did not reconcile');
  if (!verify(compact)) errors.push('Compact settlement did not reconcile');
  return { totalCents:total, balances, allocations, pairwise, compact, errors, warnings, reconciled: !errors.length, eligibleCount: people.length };
}

// Removal changes historical allocations, so never orphan expenses paid by this person.
// Returns a new trip; callers decide when to persist it after confirmation.
export function removeParticipant(trip, personId) {
  const person = (trip.people || []).find(p => p.id === personId);
  if (!person) throw new Error('Participant not found');
  const payerCount = (trip.expenses || []).filter(e => e.payerId === personId).length;
  if (payerCount) throw new Error(`${person.name} paid for ${payerCount} ${payerCount === 1 ? 'expense' : 'expenses'}. Reassign or delete those expenses before removing this participant.`);
  const updated = structuredClone(trip);
  updated.people = updated.people.filter(p => p.id !== personId);
  updated.categories.forEach(category => {
    category.excludedIds = (category.excludedIds || []).filter(id => id !== personId);
  });
  updated.expenses.forEach(e => {
    if (Array.isArray(e.participantIds)) e.participantIds = e.participantIds.filter(id => id !== personId);
  });
  updated.paidTransfers = [];
  const result = compute(updated);
  if (result.errors.length) throw new Error(`Removing ${person.name} would invalidate the trip: ${result.errors.join('; ')}`);
  return updated;
}
