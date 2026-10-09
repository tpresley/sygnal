// Experiment 5: a decision model as a command bar over the same action metadata (no chat model):
// one /v1/systemone call picks the action (choice over the component's agent actions) and the
// target todo (choice over the current todos); free text (ADD) is taken from the command.
const BASE = 'http://localhost:11434';
const actions = {
  ADD: 'Add a new todo', TOGGLE: 'Mark an existing todo done or not done', REMOVE: 'Delete an existing todo',
  SET_FILTER_ACTIVE: 'Show only todos that are not done', SET_FILTER_DONE: 'Show only completed todos', SET_FILTER_ALL: 'Show every todo',
};
const todos = [{id: 1, text: 'water plants'}, {id: 2, text: 'buy milk'}, {id: 3, text: 'call mom'}];
const CASES = [
  ['add walk the dog', 'ADD', null], ['mark water plants as done', 'TOGGLE', 1], ['I bought the milk', 'TOGGLE', 2],
  ['get rid of the call mom item', 'REMOVE', 3], ['only show what is left to do', 'SET_FILTER_ACTIVE', null],
  ['show me everything', 'SET_FILTER_ALL', null], ['what have I finished?', 'SET_FILTER_DONE', null], ['delete buy milk', 'REMOVE', 2],
];
let ok = 0;
const rows = [];
for (const [cmd, wantA, wantT] of CASES) {
  const t0 = performance.now();
  const r = await fetch(`${BASE}/v1/systemone`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({
    model: 'nimble', state: {command: cmd, todos},
    questions: {
      action: {type: 'choice', instructions: 'Which app action does the command ask for?', criteria: actions},
      target: {type: 'choice', instructions: 'Which existing todo does the command refer to (none if it names no existing todo)?', criteria: {none: 'no existing todo', ...Object.fromEntries(todos.map(t => [String(t.id), t.text]))}},
    },
  })}).then(r => r.json());
  const a = r.answers.action, t = r.answers.target;
  const target = t.choice === 'none' ? null : +t.choice;
  const good = a.choice === wantA && (wantT === null || target === wantT);
  ok += good;
  rows.push({cmd, action: a.choice, aConf: a.confidence.toFixed(2), target, tConf: t.confidence.toFixed(2), good, ms: Math.round(performance.now() - t0)});
}
console.table(rows);
console.log(`${ok}/${CASES.length} correct`);
