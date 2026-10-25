import { compute, cents, dollars, uid, eligiblePeople, removeParticipant, removeCategory, benefitDayError, validDay } from './engine.mjs?v=1.0.1';
import { initStore, createShared, loadLocal, save, isShared, disconnect } from './storage.mjs';
const APP_VERSION = '1.0.1';
// The backend persists the trip JSON. These variables only control what the
// current browser is displaying (tab, open editor, messages, etc.).
let trip;
let tab = 'expenses';
let mode = 'local';
let editing = null;
let participantOverride = null;
let notification = '';
let editingDaysFor = null; // UI-only state; attendance is saved only after Save is clicked.
const app = document.querySelector('#app');
const el = (id) => document.querySelector(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const name = id => trip.people.find(p => p.id === id)?.name || 'Unknown';
const cat = id => trip.categories.find(c => c.id === id)?.name || 'Unknown';
const rows = (body) => body.length ? body : '<tr><td colspan="8" class="empty">Nothing here yet.</td></tr>';
// Generate the trip's dates for the participant day picker. The 62-day
// safety limit is inherited from v0.1.2; it is not changed in this release.
function isoDays() {
    if (!trip.startDate || !trip.endDate) return [];

    const first = new Date(`${trip.startDate}T12:00:00`);
    const last = new Date(`${trip.endDate}T12:00:00`);
    const dates = [];

    for (let day = first; day <= last && dates.length < 62; day.setDate(day.getDate() + 1)) {
        dates.push(day.toISOString().slice(0, 10));
    }
    return dates;
}
const eligibleFor = e => eligiblePeople(trip, e).map(p => p.id);
// A missing `days` property means "all trip days"; an empty array means "none".
function attendanceLabel(person) {
    if (!Array.isArray(person.days)) return 'All trip days (automatic)';
    if (!person.days.length) return 'No trip days selected';
    const noun = person.days.length === 1 ? 'day' : 'days';
    return `${person.days.length} trip ${noun} selected`;
}
const readableDates = () => trip.startDate && trip.endDate ? `${trip.startDate} to ${trip.endDate}` : 'the trip dates';
const noDayWarning = 'No day chosen. Everyone included in this category shares the cost, no matter which days they’re going.';
async function persist() {
    try {
        await save(trip);
        notification = 'Saved';
        render();
    }
    catch (err) {
        notification = 'Save failed: ' + err.message + ' — reload before making further edits';
        render();
    }
}
function mutate(fn) {
    if (trip.locked) {
        alert('Trip is locked. Unlock it in Settings to edit.');
        return;
    }
    fn();
    trip.revision = (trip.revision || 0) + 1;
    persist();
}
// -----------------------------------------------------------------------------
// Page layout. Each function below renders one visible piece of the interface.
// Template expressions use esc() for user-entered names and descriptions.
// -----------------------------------------------------------------------------
function headerView() {
    return `
    <header class="top">
      <div class="brand">
        △ Cragshare
        <small>SPLIT THE TRIP, NOT THE FRIENDSHIP</small>
      </div>
      <div class="buttons">
        <span class="pill">${isShared() ? '● Shared live' : '◯ Local demo'}</span>
        <span class="version-tag">v${APP_VERSION}</span>
        <button class="button secondary small" id="export">Export JSON</button>
      </div>
    </header>`;
}
function tripHeaderView() {
    return `
    <div class="hero">
      <div>
        <h1>${esc(trip.name)}</h1>
        <p class="sub">
          ${esc(trip.startDate || 'Dates to be set')} – ${esc(trip.endDate || '')}
          · ${trip.people.length} participants · ${trip.expenses.length} expenses
          ${trip.locked ? ' · Locked' : ''}
        </p>
      </div>
      <div class="buttons">
        <button class="button secondary" id="newTrip">New trip</button>
        ${isShared()
        ? '<button class="button secondary" id="copyInvite">Copy trip link</button>'
        : '<button class="button" id="shareTrip">Create shared trip</button>'}
      </div>
    </div>`;
}
function feedbackView(result) {
    return `
    ${notification
        ? `<div class="${notification.startsWith('Save failed') ? 'warn' : 'success'}">${esc(notification)}</div>`
        : ''}
    ${result.errors.length ? `
      <div class="warn">
        <b>Some costs need fixing before balances or payments can be trusted.</b>
        <ul>${result.errors.map(error => `<li>${esc(error)}</li>`).join('')}</ul>
      </div>` : ''}
    ${result.warnings.length ? `
      <div class="warn">
        <b>Check these costs:</b>
        <ul>${result.warnings.map(warning => `<li>${esc(warning)}</li>`).join('')}</ul>
      </div>` : ''}`;
}
function overviewView(result) {
    const enteredTotal = trip.expenses.reduce((sum, expense) => sum + (Number(expense.amountCents) || 0), 0);
    return `
    <div class="stats">
      <div class="stat">
        <div class="label">Group spending</div>
        <div class="val">${dollars(enteredTotal)}</div>
      </div>
      <div class="stat">
        <div class="label">People sharing</div>
        <div class="val">${trip.people.length}</div>
      </div>
      <div class="stat">
        <div class="label">Payments to make</div>
        <div class="val">${result.errors.length ? '—' : result.compact.length}</div>
      </div>
    </div>`;
}
const tabs = [
    ['expenses', 'Expenses'],
    ['balances', 'Balances'],
    ['settle', 'Settlement'],
    ['rules', 'Categories & people'],
    ['settings', 'Trip settings'],
];
function navigationView() {
    return `<nav class="tabs">${tabs.map(([id, title]) => `
    <button class="tab ${tab === id ? 'active' : ''}" data-tab="${id}">
      ${title}
    </button>`).join('')}</nav>`;
}
function activeView(result) {
    if (tab === 'expenses')
        return expensesView(result);
    if (tab === 'balances')
        return balanceView(result);
    if (tab === 'settle')
        return settleView(result);
    if (tab === 'rules')
        return rulesView();
    return settingsView();
}
/** Recompute before each render; the original expense data remains authoritative. */
function render() {
    const result = compute(trip);
    app.innerHTML = `
    ${headerView()}
    <main class="page">
      ${tripHeaderView()}
      ${feedbackView(result)}
      ${overviewView(result)}
      ${navigationView()}
      ${activeView(result)}
    </main>
    <div class="footer">Version ${APP_VERSION} · Every cent is accounted for</div>`;
    bind();
}
// -----------------------------------------------------------------------------
// Expenses
// -----------------------------------------------------------------------------
function expenseRow(expense) {
    const category = trip.categories.find(c => c.id === expense.categoryId);
    const dayMissing = category?.useAttendance
        && !expense.benefitDate
        && !Array.isArray(expense.participantIds);
    return `
    <tr>
      <td>${esc(expense.purchaseDate || '—')}</td>
      <td>${esc(expense.title)}</td>
      <td><span class="chip">${esc(cat(expense.categoryId))}</span></td>
      <td>${esc(name(expense.payerId))}</td>
      <td class="money">${dollars(expense.amountCents)}</td>
      <td>
        ${benefitDayError(trip, expense.benefitDate)
        ? '<span class="neg">Fix date</span>'
        : `${eligibleFor(expense).length} people${expense.participantIds ? ' · chosen manually' : ''}`}
        ${dayMissing ? '<span class="smallmeta">· No day chosen</span>' : ''}
      </td>
      <td>
        <button data-edit="${esc(expense.id)}" class="button secondary small">Edit</button>
      </td>
    </tr>`;
}
function expensesView() {
    return `
    <section class="panel">
      <div class="sectionhead">
        <h2>${editing ? 'Edit expense' : 'Expense log'}</h2>
        <button class="button secondary small" id="exportCSV">Export CSV</button>
      </div>
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Date bought</th><th>Expense</th><th>Category</th>
              <th>Paid by</th><th class="money">Amount</th><th>Who shares</th><th></th>
            </tr>
          </thead>
          <tbody>${rows(trip.expenses.map(expenseRow).join(''))}</tbody>
        </table>
      </div>
    </section>
    <section class="panel">
      <div class="sectionhead">
        <h2>${editing ? 'Edit expense' : 'Add an expense'}</h2>
        ${editing ? '<button class="button secondary small" id="cancelEdit">Cancel</button>' : ''}
      </div>
      ${expenseForm()}
    </section>`;
}
function expenseForm() {
    const expense = editing ? trip.expenses.find(item => item.id === editing) : null;
    const chosen = participantOverride ?? (expense?.participantIds ?? null);
    const dateLimits = trip.startDate && trip.endDate
        ? `min="${esc(trip.startDate)}" max="${esc(trip.endDate)}"`
        : '';
    const tripDatesHint = trip.startDate && trip.endDate
        ? `Choose a day from ${esc(readableDates())}.`
        : 'Set your trip dates in Trip settings first.';
    return `
    <form id="expenseForm" class="fields">
      <label class="field">Expense description
        <input name="title" required maxlength="120"
               value="${esc(expense?.title || '')}" placeholder="Groceries for dinner">
      </label>
      <label class="field">Amount ($)
        <input name="amount" type="number" min="0.01" step="0.01" required
               value="${expense ? (expense.amountCents / 100).toFixed(2) : ''}"
               placeholder="0.00">
      </label>
      <label class="field">Paid by
        <select name="payerId" required>
          ${trip.people.map(person => `
            <option value="${esc(person.id)}" ${expense?.payerId === person.id ? 'selected' : ''}>
              ${esc(person.name)}
            </option>`).join('')}
        </select>
      </label>
      <label class="field">Category
        <select name="categoryId">
          ${trip.categories.map(category => `
            <option value="${esc(category.id)}" ${expense?.categoryId === category.id ? 'selected' : ''}>
              ${esc(category.name)}
            </option>`).join('')}
        </select>
      </label>
      <label class="field">Date bought
        <input name="purchaseDate" type="date" value="${esc(expense?.purchaseDate || '')}">
      </label>
      <label class="field">Day this was for (optional)
        <input name="benefitDate" type="date" ${dateLimits}
               value="${esc(expense?.benefitDate || '')}">
        <span class="hint">
          For meals or supplies tied to one day. ${tripDatesHint}
          It doesn’t have to be the day you bought it.
        </span>
        <span id="dayWarning" class="hint" role="status"></span>
      </label>
      <label class="field full">Notes
        <textarea name="notes">${esc(expense?.notes || '')}</textarea>
      </label>
      <div class="field full">
        <label>
          <input type="checkbox" id="customToggle" ${chosen ? 'checked' : ''}>
          Customize who shares this expense
        </label>
        <p class="hint">
          Leave this off to use the category rules and trip days.
          The date you bought something never determines who pays.
        </p>
        <div id="sharePeople" class="checkgrid" style="${chosen ? '' : 'display:none'}">
          ${trip.people.map(person => `
            <label class="check">
              <input type="checkbox" name="eligible" value="${esc(person.id)}"
                     ${!chosen || chosen.includes(person.id) ? 'checked' : ''}>
              ${esc(person.name)}
            </label>`).join('')}
        </div>
      </div>
      <div class="buttons">
        <button class="button" type="submit">${editing ? 'Update' : 'Add'} expense</button>
        ${editing
        ? '<button type="button" class="button danger" id="deleteExpense">Delete expense</button>'
        : ''}
      </div>
    </form>`;
}
// -----------------------------------------------------------------------------
// Balances and settlements (read-only views of the existing calculation engine)
// -----------------------------------------------------------------------------
function balanceView(result) {
    if (result.errors.length) {
        return `<section class="panel"><h2>Balances aren’t ready</h2>
      <p class="warn">Fix the flagged expenses in Expenses first.
      We won’t show incomplete balances as if they were final.</p></section>`;
    }
    return `
    <section class="panel">
      <div class="sectionhead">
        <h2>Who paid vs. who owes</h2>
        <span class="chip">${result.reconciled ? '✓ All costs accounted for' : 'Needs attention'}</span>
      </div>
      <div class="tablewrap">
        <table>
          <thead><tr>
            <th>Person</th><th class="money">Paid</th><th class="money">Assigned share</th>
            <th class="money">Net balance</th><th>Status</th>
          </tr></thead>
          <tbody>${result.balances.map(balance => `
            <tr>
              <td><b>${esc(balance.name)}</b></td>
              <td class="money">${dollars(balance.paidCents)}</td>
              <td class="money">${dollars(balance.shareCents)}</td>
              <td class="money ${balance.netCents < 0 ? 'neg' : balance.netCents > 0 ? 'pos' : ''}">
                ${balance.netCents > 0 ? '+' : ''}${dollars(balance.netCents)}
              </td>
              <td>${balance.netCents > 0 ? 'Should receive' : balance.netCents < 0 ? 'Should pay' : 'Even'}</td>
            </tr>`).join('')}</tbody>
        </table>
      </div>
    </section>
    <section class="panel">
      <div class="sectionhead"><h2>Assigned shares by category</h2></div>
      <div class="tablewrap">
        <table>
          <thead><tr>
            <th>Person</th>
            ${trip.categories.map(category => `<th class="money">${esc(category.name)}</th>`).join('')}
          </tr></thead>
          <tbody>${result.balances.map(balance => `
            <tr>
              <td>${esc(balance.name)}</td>
              ${trip.categories.map(category => `
                <td class="money">${dollars(balance.byCategory[category.id] || 0)}</td>`).join('')}
            </tr>`).join('')}</tbody>
        </table>
      </div>
    </section>`;
}
function settleView(result) {
    if (result.errors.length) {
        return `<section class="panel"><h2>Payments aren’t ready</h2>
      <p class="warn">Fix the flagged expenses first so no one gets an incorrect payment amount.</p></section>`;
    }
    // Preserve the user's chosen settlement style when switching between tabs.
    const method = document.querySelector('[name="method"]:checked')?.value
        || window.__settleMethod || 'compact';
    const payments = method === 'pairwise' ? result.pairwise : result.compact;
    return `
    <section class="panel">
      <div class="sectionhead">
        <h2>Who pays whom</h2>
        <span class="chip">${result.reconciled ? '✓ All payments add up' : 'Check required'}</span>
      </div>
      <div class="buttons">
        <label class="check">
          <input type="radio" name="method" value="compact"
                 ${method === 'compact' ? 'checked' : ''}> Fewer payments
        </label>
        <label class="check">
          <input type="radio" name="method" value="pairwise"
                 ${method === 'pairwise' ? 'checked' : ''}> Pay each person directly
        </label>
      </div>
      <p class="hint">
        Fewer payments combines amounts so people don’t have to pay everyone who bought something.
        Pay each person directly follows the purchases but may create more payments.
        The first option aims for fewer payments, not necessarily the absolute fewest.
      </p>
      <div class="tablewrap">
        <table>
          <thead><tr><th>From</th><th>To</th><th class="money">Amount</th><th>Paid</th></tr></thead>
          <tbody>${rows(payments.map(payment => {
        const key = [method, payment.from, payment.to, payment.amountCents].join(':');
        return `
              <tr>
                <td>${esc(name(payment.from))}</td>
                <td>${esc(name(payment.to))}</td>
                <td class="money">${dollars(payment.amountCents)}</td>
                <td><input type="checkbox" class="paidBox" data-key="${esc(key)}"
                           ${trip.paidTransfers?.includes(key) ? 'checked' : ''}></td>
              </tr>`;
    }).join(''))}</tbody>
        </table>
      </div>
      <p class="hint">Choose a payment plan, then check payments off when they’re sent. The app doesn’t send money.</p>
    </section>`;
}
// -----------------------------------------------------------------------------
// Categories and people: small view functions keep each editable unit together.
// -----------------------------------------------------------------------------
/** Renders the day picker next to the person being edited, not at page bottom. */
function tripDaysPopover(person) {
    if (editingDaysFor !== person.id)
        return '';
    const days = isoDays();
    const selectedDays = !Array.isArray(person.days) ? days : person.days;
    return `
    <div class="attendance-popover" id="trip-days-${esc(person.id)}"
         role="dialog" aria-label="Trip days for ${esc(person.name)}">
      <div class="sectionhead">
        <strong>Trip days — ${esc(person.name)}</strong>
        <button type="button" class="button secondary small" data-close-days
                aria-label="Close trip days editor">✕</button>
      </div>
      <p class="hint">
        Select the days they’ll be here. Everyone starts with all trip days.
        If you uncheck every day, they won’t share expenses tied to a specific day.
        Expenses without a day still follow the category’s sharing rules.
      </p>
      ${days.length ? `
        <div class="checkgrid attendance-days">
          ${days.map(day => `
            <label class="check">
              <input type="checkbox" name="day" value="${day}"
                     ${selectedDays.includes(day) ? 'checked' : ''}>
              ${day}
            </label>`).join('')}
        </div>` : '<p class="warn">Set the trip dates in Trip settings first.</p>'}
      <div class="buttons attendance-actions">
        <button type="button" class="button small" data-save-days
                ${days.length ? '' : 'disabled'}>Save days</button>
        <button type="button" class="button secondary small" data-default-days>
          Use all trip days
        </button>
        <button type="button" class="button secondary small" data-close-days>Cancel</button>
      </div>
    </div>`;
}
function participantRow(person) {
    return `
    <div class="rule participant-rule">
      <div class="sectionhead" style="margin:0">
        <b>${esc(person.name)}</b>
        <div class="buttons">
          <button type="button" class="button secondary small" data-attend="${esc(person.id)}"
                  aria-expanded="${editingDaysFor === person.id}"
                  aria-controls="trip-days-${esc(person.id)}">Trip days</button>
          <button type="button" class="button danger small" data-remove-person="${esc(person.id)}"
                  aria-label="Remove ${esc(person.name)}">Remove</button>
        </div>
      </div>
      <div class="hint">${attendanceLabel(person)}</div>
      ${tripDaysPopover(person)}
    </div>`;
}
function categoryRow(category) {
    const includedCount = trip.people.length - category.excludedIds.length;
    return `
    <div class="rule">
      <div class="sectionhead" style="margin:0">
        <b>${esc(category.name)}</b>
        <div class="buttons">
          <span class="smallmeta">${includedCount} included</span>
          <button type="button" class="button danger small"
                  data-remove-category="${esc(category.id)}"
                  aria-label="Remove category ${esc(category.name)}">Remove</button>
        </div>
      </div>
      <p class="hint">Check everyone who should normally share this type of cost:</p>
      <div class="checkgrid">
        ${trip.people.map(person => `
          <label class="check">
            <input data-category="${esc(category.id)}" data-person="${esc(person.id)}"
                   type="checkbox"
                   ${!category.excludedIds.includes(person.id) ? 'checked' : ''}>
            ${esc(person.name)}
          </label>`).join('')}
      </div>
      <label class="check" style="margin-top:9px">
        <input type="checkbox" data-attendance-category="${esc(category.id)}"
               ${category.useAttendance ? 'checked' : ''}>
        Only split with people going that day
      </label>
    </div>`;
}
function rulesView() {
    return `
    <div class="grid2">
      <section class="panel">
        <div class="sectionhead"><h2>Participants (${trip.people.length})</h2></div>
        <form id="addPerson" class="buttons">
          <input name="name" required maxlength="60" placeholder="Participant name"
                 class="inline-name-input">
          <button class="button" type="submit">Add person</button>
        </form>
        ${trip.people.map(participantRow).join('')}
      </section>
      <section class="panel">
        <div class="sectionhead"><h2>Who shares which costs</h2></div>
        <form id="addCategory" class="buttons">
          <input name="name" required maxlength="60" placeholder="Category name"
                 class="inline-name-input">
          <button class="button" type="submit">Add category</button>
        </form>
        ${trip.categories.map(categoryRow).join('')}
      </section>
    </div>`;
}
// -----------------------------------------------------------------------------
// Trip settings and backups
// -----------------------------------------------------------------------------
function settingsView() {
    return `
    <section class="panel">
      <h2>Trip settings</h2>
      <form id="tripSettings" class="fields" style="margin-top:14px">
        <label class="field full">Trip name
          <input name="name" required value="${esc(trip.name)}">
        </label>
        <label class="field">Trip start
          <input name="startDate" type="date" value="${esc(trip.startDate || '')}">
        </label>
        <label class="field">Trip end
          <input name="endDate" type="date" value="${esc(trip.endDate || '')}">
        </label>
        <label class="check full">
          <input type="checkbox" name="locked" ${trip.locked ? 'checked' : ''}>
          Lock trip to prevent accidental expense changes
        </label>
        <button class="button" type="submit">Save trip settings</button>
        <p class="hint full">
          Days attached to expenses must fall between the trip start and end.
          Change an expense’s day before shortening the trip.
        </p>
      </form>
      <div class="buttons" style="margin-top:20px">
        <button class="button secondary" id="exportAgain">Download backup JSON</button>
        <label class="button secondary" style="cursor:pointer">
          Import backup JSON
          <input id="importJSON" type="file" accept="application/json" style="display:none">
        </label>
      </div>
      <p class="hint">
        A JSON backup preserves rules, attendance, expenses, and paid flags.
        Import replaces the current trip after confirmation.
      </p>
    </section>`;
}
function download(filename, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
}
// -----------------------------------------------------------------------------
// Event handlers. DOM nodes are recreated by render(), so controls are bound
// again after each render. Only the Escape listener is installed once at boot.
// -----------------------------------------------------------------------------
function bindNavigationAndExports() {
    document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; editing = null; participantOverride = null; editingDaysFor = null; notification = ''; render(); });
    el('#export').onclick = () => download('cragshare-trip.json', JSON.stringify(trip, null, 2), 'application/json');
    if (el('#exportAgain'))
        el('#exportAgain').onclick = el('#export').onclick;
    if (el('#exportCSV'))
        el('#exportCSV').onclick = () => { let arr = [['Date', 'Expense', 'Category', 'Payer', 'Amount', 'Notes'], ...trip.expenses.map(e => [e.purchaseDate, e.title, cat(e.categoryId), name(e.payerId), (e.amountCents / 100).toFixed(2), e.notes || ''])]; download('trip-expenses.csv', arr.map(row => row.map(v => '"' + String(v || '').replaceAll('"', '""') + '"').join(',')).join('\n'), 'text/csv'); };
    el('#newTrip').onclick = async () => {
        if (!confirm('Start a new trip? Export a backup first if needed.'))
            return;
        const old = trip;
        await disconnect();
        location.hash = '';
        trip = { id: uid(), name: 'New climbing trip', startDate: '', endDate: '', locked: false, people: [], categories: [], expenses: [], paidTransfers: [], revision: 0 };
        for (const c of old.categories)
            trip.categories.push({ id: uid(), name: c.name, excludedIds: [], useAttendance: false });
        tab = 'rules';
        persist();
    };
    if (el('#shareTrip'))
        el('#shareTrip').onclick = async () => {
            try {
                if (!confirm('Create a shared copy of this trip? You will receive a private invite link.'))
                    return;
                const res = await createShared(trip, t => { trip = t; notification = 'Updated by another participant'; render(); });
                mode = 'shared';
                location.hash = new URL(res.inviteUrl).hash;
                notification = 'Shared trip created. Copy the invitation link to share.';
                render();
            }
            catch (e) {
                alert('Shared setup unavailable: ' + e.message + '\nConfigure Supabase and enable anonymous sign-ins (see README).');
            }
        };
    if (el('#copyInvite'))
        el('#copyInvite').onclick = async () => { await navigator.clipboard.writeText(location.href); notification = 'Invite link copied'; render(); };
}
function bindExpenseControls() {
    if (el('#expenseForm')) {
        const form = el('#expenseForm');
        const updateDayWarning = () => {
            const selectedCategory = trip.categories.find(c => c.id === form.elements.categoryId.value);
            const day = form.elements.benefitDate.value;
            const manual = form.querySelector('#customToggle').checked;
            const problem = benefitDayError(trip, day);
            const message = problem || (!manual && selectedCategory?.useAttendance && !day ? noDayWarning : '');
            const target = form.querySelector('#dayWarning');
            target.textContent = message;
            target.className = message ? 'warn' : 'hint';
            if (manual && !problem)
                target.textContent = '';
        };
        form.elements.categoryId.addEventListener('change', updateDayWarning);
        form.elements.benefitDate.addEventListener('input', updateDayWarning);
        updateDayWarning();
        form.querySelector('#customToggle').onchange = e => {
            el('#sharePeople').style.display = e.target.checked ? 'grid' : 'none';
            if (e.target.checked) {
                // Start an override from the current category and attendance defaults,
                // rather than silently including everyone when the override is opened.
                const defaults = eligibleFor({ categoryId: form.elements.categoryId.value, benefitDate: form.elements.benefitDate.value, participantIds: null });
                form.querySelectorAll('[name="eligible"]').forEach(cb => cb.checked = defaults.includes(cb.value));
            }
            updateDayWarning();
        };
        form.onsubmit = e => {
            e.preventDefault();
            const f = new FormData(form);
            const amount = cents(f.get('amount'));
            if (amount <= 0)
                return alert('Enter a positive amount.');
            const day = f.get('benefitDate');
            const dayError = benefitDayError(trip, day);
            if (dayError)
                return alert(dayError);
            const selectedCategory = trip.categories.find(c => c.id === f.get('categoryId'));
            if (!form.querySelector('#customToggle').checked && selectedCategory?.useAttendance && !day) {
                if (!confirm('No day chosen. Everyone included in this category will share the cost, no matter which days they’re going. Save anyway?'))
                    return;
            }
            const chosen = form.querySelector('#customToggle').checked ? Array.from(form.querySelectorAll('[name="eligible"]:checked')).map(e => e.value) : null;
            if (chosen && !chosen.length)
                return alert('Select at least one person.');
            mutate(() => {
                const exp = { id: editing || uid(), title: f.get('title').trim(), payerId: f.get('payerId'), categoryId: f.get('categoryId'), amountCents: amount, purchaseDate: f.get('purchaseDate'), benefitDate: f.get('benefitDate'), notes: f.get('notes'), participantIds: chosen };
                if (editing)
                    trip.expenses = trip.expenses.map(e => e.id === editing ? exp : e);
                else
                    trip.expenses.push(exp);
                trip.paidTransfers = [];
                editing = null;
                participantOverride = null;
            });
        };
    }
    document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { editing = b.dataset.edit; participantOverride = null; render(); el('#expenseForm').scrollIntoView({ behavior: 'smooth' }); });
    if (el('#cancelEdit'))
        el('#cancelEdit').onclick = () => { editing = null; render(); };
    if (el('#deleteExpense'))
        el('#deleteExpense').onclick = () => {
            if (confirm('Delete this expense?'))
                mutate(() => { trip.expenses = trip.expenses.filter(e => e.id !== editing); trip.paidTransfers = []; editing = null; });
        };
}
function bindSettlementControls() {
    document.querySelectorAll('[name="method"]').forEach(b => b.onchange = () => { window.__settleMethod = b.value; render(); });
    document.querySelectorAll('.paidBox').forEach(b => b.onchange = () => mutate(() => { trip.paidTransfers = trip.paidTransfers || []; trip.paidTransfers = b.checked ? [...trip.paidTransfers, b.dataset.key] : trip.paidTransfers.filter(x => x !== b.dataset.key); }));
}
function bindPeopleAndCategoryControls() {
    if (el('#addPerson'))
        el('#addPerson').onsubmit = e => {
            e.preventDefault();
            const n = new FormData(e.target).get('name').trim();
            if (!n)
                return;
            if (trip.people.some(p => p.name.toLowerCase() === n.toLowerCase()))
                return alert('Name already exists');
            mutate(() => trip.people.push({ id: uid(), name: n }));
        };
    if (el('#addCategory'))
        el('#addCategory').onsubmit = e => {
            e.preventDefault();
            const n = new FormData(e.target).get('name').trim();
            if (!n)
                return;
            mutate(() => trip.categories.push({ id: uid(), name: n, excludedIds: [], useAttendance: false }));
        };
    // A category used by an expense must not disappear: its shares depend on that rule.
    document.querySelectorAll('[data-remove-category]').forEach(button => button.onclick = () => {
        const category = trip.categories.find(c => c.id === button.dataset.removeCategory);
        if (!category)
            return;
        if (trip.locked)
            return alert('Trip is locked. Unlock it in Settings to edit.');
        const usageCount = trip.expenses.filter(expense => expense.categoryId === category.id).length;
        if (usageCount) {
            return alert(`You can't remove ${category.name} yet. ${usageCount} ${usageCount === 1 ? 'expense uses' : 'expenses use'} this category. Change those expenses to another category first.`);
        }
        if (!confirm(`Remove the category "${category.name}"? No expenses will be changed.`))
            return;
        const updated = removeCategory(trip, category.id);
        mutate(() => {
            trip.categories = updated.categories;
            notification = `${category.name} removed`;
            // No expense used this category, so balances and paid checks do not change.
        });
    });
    document.querySelectorAll('[data-category][data-person]').forEach(b => b.onchange = () => mutate(() => { const c = trip.categories.find(x => x.id === b.dataset.category); c.excludedIds = b.checked ? c.excludedIds.filter(x => x !== b.dataset.person) : [...c.excludedIds, b.dataset.person]; trip.paidTransfers = []; }));
    document.querySelectorAll('[data-attendance-category]').forEach(b => b.onchange = () => mutate(() => { trip.categories.find(c => c.id === b.dataset.attendanceCategory).useAttendance = b.checked; trip.paidTransfers = []; }));
    // The popover exists inside the selected participant's row, so it moves with
    // that row on desktop and becomes a bottom sheet on narrow screens.
    document.querySelectorAll('[data-attend]').forEach(button => button.onclick = () => {
        editingDaysFor = editingDaysFor === button.dataset.attend ? null : button.dataset.attend;
        render();
    });
    document.querySelectorAll('[data-close-days]').forEach(button => button.onclick = () => {
        editingDaysFor = null;
        render();
    });
    if (el('[data-save-days]'))
        el('[data-save-days]').onclick = () => {
            const person = trip.people.find(p => p.id === editingDaysFor);
            const panel = el('.attendance-popover');
            if (!person || !panel)
                return;
            const days = [...panel.querySelectorAll('[name="day"]:checked')].map(input => input.value);
            mutate(() => {
                person.days = days; // [] explicitly means this person attends no days.
                trip.paidTransfers = [];
                notification = `Trip days updated for ${person.name}`;
                editingDaysFor = null;
            });
        };
    if (el('[data-default-days]'))
        el('[data-default-days]').onclick = () => {
            const person = trip.people.find(p => p.id === editingDaysFor);
            if (!person)
                return;
            mutate(() => {
                delete person.days; // Missing days means they attend every day of the trip.
                trip.paidTransfers = [];
                notification = `${person.name} is included on all trip days`;
                editingDaysFor = null;
            });
        };
    document.querySelectorAll('[data-remove-person]').forEach(b => b.onclick = () => {
        const p = trip.people.find(p => p.id === b.dataset.removePerson);
        if (!p)
            return;
        if (trip.locked) {
            alert('Trip is locked. Unlock it in Settings to edit.');
            return;
        }
        const purchases = trip.expenses.filter(e => e.payerId === p.id);
        if (purchases.length) {
            alert(`Cannot remove ${p.name}: they paid for ${purchases.length} ${purchases.length === 1 ? 'expense' : 'expenses'}. Edit those expenses to assign another payer or delete them first.`);
            return;
        }
        const affected = compute(trip).allocations.filter(a => a.eligibleIds.includes(p.id)).length;
        let proposed;
        try {
            proposed = removeParticipant(trip, p.id);
        }
        catch (err) {
            alert(err.message);
            return;
        }
        if (!confirm(`Remove ${p.name} from this trip? ${affected} ${affected === 1 ? 'expense share' : 'expense shares'} will be recalculated. Recorded payment checkmarks will be cleared. Export a backup first if you may need to undo this.`))
            return;
        mutate(() => { trip.people = proposed.people; trip.categories = proposed.categories; trip.expenses = proposed.expenses; trip.paidTransfers = []; });
    });
}
function bindTripSettings() {
    if (el('#tripSettings'))
        el('#tripSettings').onsubmit = e => {
            e.preventDefault();
            const f = new FormData(e.target);
            const start = f.get('startDate'), end = f.get('endDate');
            if ((start && !validDay(start)) || (end && !validDay(end)) || (start && end && start > end))
                return alert('Check the trip dates. The end must be on or after the start.');
            const candidate = { ...trip, startDate: start, endDate: end };
            const outside = trip.expenses.filter(x => benefitDayError(candidate, x.benefitDate));
            if (outside.length)
                return alert(`These costs have days outside the new trip dates: ${outside.map(x => x.title).join(', ')}. Edit their days first, then try again.`);
            trip.locked = false;
            mutate(() => { trip.name = f.get('name'); trip.startDate = start; trip.endDate = end; trip.locked = f.has('locked'); });
        };
    if (el('#importJSON'))
        el('#importJSON').onchange = async (e) => {
            try {
                const next = JSON.parse(await e.target.files[0].text());
                if (!Array.isArray(next.people) || !Array.isArray(next.expenses) || !Array.isArray(next.categories))
                    throw Error('Invalid trip backup');
                if (confirm('Replace this trip with the imported backup?')) {
                    trip = next;
                    editing = null;
                    persist();
                }
            }
            catch (err) {
                alert(err.message);
            }
        };
}
function bind() {
    bindNavigationAndExports();
    bindExpenseControls();
    bindSettlementControls();
    bindPeopleAndCategoryControls();
    bindTripSettings();
}
async function boot() {
    try {
        const result = await initStore(t => { trip = t; notification = 'Someone updated the trip'; render(); });
        mode = result.mode;
        trip = result.trip || await loadLocal() || await (await fetch('./acadia-sample.json')).json();
        render();
    }
    catch (e) {
        app.innerHTML = `<main class="page"><h1>Could not open shared trip</h1><div class="warn">${esc(e.message)}</div><p>Check your invite link or Supabase configuration.</p></main>`;
    }
}
// Escape closes only the open trip-days editor. The rest of the app is unchanged.
document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && editingDaysFor) {
        editingDaysFor = null;
        render();
    }
});
boot();
