// Experiment 4: a decision model (Jev-style /v1/systemone, local Ollama `nimble`) from a Sygnal
// component with NO new driver: the existing makeFetchDriver + reply actions. Then the same with
// a 12-line decide() request helper, and confidence-based escalation to a chat model.
import {renderComponent, makeFetchDriver, createElement as h, ABORT} from 'sygnal';

const BASE = 'http://localhost:11434';
// the helper a `sygnal` decision API could ship: questions in, an HTTP request out
const choice = (instructions, criteria) => ({type: 'choice', instructions, criteria});
const noul = (instructions, criteria) => ({type: 'noul', instructions, ...(criteria && {criteria})});
const decide = ({state, questions, model = 'nimble', ...rest}) => ({url: `${BASE}/v1/systemone`, json: {model, state, questions}, ...rest});

const TICKETS = [
  ['I was charged twice this month, refund please', 'billing', true],
  ['The export button crashes the app every time', 'bug', false],
  ["I can't log in, password reset email never arrives", 'account', true],
  ['Do you offer annual plans with a discount?', 'billing', false],
  ['Page shows a blank screen after the latest update', 'bug', false],
  ['Please change the email on my profile', 'account', false],
  ['URGENT: card declined but money left my bank', 'billing', true],
  ['Typo in the settings page heading', 'bug', false],
  ['My account got locked after 3 attempts, I need access now for a client demo', 'account', true],
  ['Invoice PDF has the wrong VAT number', 'billing', false],
];

function Inbox({state}) { return h('ul', null, state.tickets.map(t => h('li', null, `${t.label ?? '…'} ${t.text}`))); }
Inbox.initialState = {tickets: TICKETS.map(([text], id) => ({id, text})), escalated: 0};
// one request per action: the tickets are triaged in a chain (each reply sends the next)
Inbox.model = {
  BOOTSTRAP: {HTTP: s => req(s.tickets[0]), STATE: s => ({...s, t0: Date.now()})},
  TRIAGED: {
    STATE: (s, answers, next) => {
      const i = s.tickets.findIndex(t => t.label === undefined);
      const t = s.tickets[i];
      const conf = answers.answers.label.confidence;
      const tickets = s.tickets.map((x, j) => j === i ? {...x, label: answers.answers.label.choice, conf, urgent: answers.answers.urgent.noul > 0.5, ms: Date.now() - (s.tStart ?? s.t0)} : x);
      return {...s, tickets, tStart: Date.now(), escalated: s.escalated + (conf < 0.6)};
    },
    HTTP: (s) => { const i = s.tickets.findIndex(t => t.label === undefined); return s.tickets[i + 1] ? req(s.tickets[i + 1]) : ABORT; },
  },
  FAILED: (s, e) => ({...s, error: String(e.error?.body ?? e.error)}),
};
const req = t => decide({
  state: t.text, ok: 'TRIAGED', error: 'FAILED',
  questions: {
    label: choice('What is this support ticket about?', {billing: 'payments, charges, plans, invoices', bug: 'a defect in the software', account: 'login, access or profile'}),
    urgent: noul('Does the customer need this handled urgently?'),
  },
});

const t = renderComponent(Inbox, {drivers: {HTTP: makeFetchDriver()}});
const s = await t.waitForState(s => s.error || s.tickets.every(t => t.label), 120000);
if (s.error) { console.log('error', s.error); process.exit(1); }
const rows = s.tickets.map((x, i) => ({text: x.text.slice(0, 40), expected: TICKETS[i][1], got: x.label, conf: x.conf.toFixed(2), urgentExp: TICKETS[i][2], urgentGot: x.urgent, ms: x.ms}));
console.table(rows);
const acc = rows.filter(r => r.expected === r.got).length, uacc = rows.filter(r => r.urgentExp === r.urgentGot).length;
const msSorted = rows.map(r => r.ms).slice(1).sort((a, b) => a - b);
console.log(`label ${acc}/10, urgent ${uacc}/10, below 0.6 confidence (would escalate to a chat model): ${s.escalated}, median latency ${msSorted[Math.floor(msSorted.length / 2)]} ms (first, cold: ${rows[0].ms} ms)`);
t.dispose();
process.exit(0);
