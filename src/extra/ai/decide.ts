/*
 * PLAN-6 M-1: decisions (TypeSafe Jev, Ollama `nimble`/`clef`, OpenRouter, AI Gateway, OpenAI
 * Decisions) are plain HTTP requests, so there is no driver here: `decide()` builds a
 * `makeFetchDriver` request that works as a reply-action request (`ok` / `error`) and as a
 * `resources` entry. Types and docs: src/ai.d.ts.
 *
 * Dictionary form (TypeSafe `/v1/systemone`, Ollama ≥ 0.35 `/v1/systemone`; verified against
 * Ollama 0.40.2 + nimble):
 *   request  { model, state, questions: { name: { type, instructions, criteria? } }, images? }
 *            choice: criteria { option: description | null }; noul: criteria { true, false }
 *            (optional); score: criteria [level descriptions, lowest first]
 *   response { model, answers: { name: { type: 'choice', choice, probabilities, confidence }
 *            | { type: 'noul', noul } | { type: 'score', score, legend, probabilities, confidence } },
 *            usage: { input_tokens, output_tokens } }
 *
 * OpenAI Decisions (`POST /v1/decisions`, the array form): `decide.openai()` sends
 *   { model, input, questions: [{ type: 'predicate' | 'choice' | 'score', name, instructions,
 *     choices?: [{ value, description }], levels?: [{ label, description }] }] }
 * and its `parse` maps `{ answers: [{ type, name, … }] }` back to the dictionary form, so the
 * reply action / resource data has the same shape whichever form was sent (a refusal becomes
 * `{ type: 'refusal' }` under the question's name).
 *
 * Side-effect free (0 B for apps that don't import it).
 */

/** a `choice` question: pick one option (criteria: option → description, or an array of option names) */
export const choice = (instructions: any, criteria: any) => ({
  type: 'choice',
  instructions,
  criteria: Array.isArray(criteria) ? Object.fromEntries(criteria.map(c => [c, null])) : criteria,
});

/** a `noul` question: the probability of yes (criteria: `{ true, false }` descriptions) */
export const noul = (instructions: any, criteria?: any) =>
  criteria ? {type: 'noul', instructions, criteria} : {type: 'noul', instructions};

/** a `score` question: an ordered scale, lowest first (the answer is the weighted level index) */
export const score = (instructions: any, levels: any) => ({type: 'score', instructions, criteria: levels});

/** the dictionary-form request (TypeSafe, Ollama, OpenRouter, AI Gateway) */
function dictionary({url = '/api/decide', model, state, questions, images, ...rest}: any = {}) {
  const json: any = {model, state, questions};
  if (images) json.images = images;
  return {url, method: 'POST', json, ...rest};
}

// ---------- D472 / G-757: large question sets ----------
/**
 * A conservative estimate of the prompt tokens of a request's question (Ollama /v1/systemone: each
 * question's prompt holds the state and EVERY question of the request, instructions and options).
 * Measured on nimble over compose.decisions()'s requests: 1.13–1.30 × the count Ollama reports
 * (ASCII ~2.6 characters a token; any other character counted as one).
 */
const tokensOf = (x: any) => {
  const t = text(x ?? '');
  let other = 0;
  for (let i = 0; i < t.length; i++) if (t.charCodeAt(i) > 127) other++;
  return (t.length - other) / 2.5 + other;
};
const questionTokens = (name: string, q: any) => {
  const c = q?.criteria, opts: any[] = Array.isArray(c) ? c.map(x => [x, null]) : Object.entries(c && typeof c == 'object' ? c : {});
  return 12 + 4 * opts.length + tokensOf(name) + tokensOf(q?.instructions) + opts.reduce((n, [k, v]) => n + tokensOf(k) + (v == null ? 0 : tokensOf(v)), 0);
};
/** the estimated prompt tokens of one question of a request with this state and these questions */
export const promptTokens = (state: any, questions: any) => Math.ceil(60 + tokensOf(state ?? '') +
  Object.keys(questions || {}).reduce((n, k) => n + questionTokens(k, questions[k]), 0));

/**
 * The questions in parts within `maxQuestions` and `maxPromptTokens` (the estimate): one part when
 * they fit; else the fewest parts of about even size (by the estimate), in question order. A
 * question too large on its own goes alone.
 */
export function splitQuestions(state: any, questions: any, maxQuestions = Infinity, maxPromptTokens = Infinity): string[][] {
  const all = Object.keys(questions || {});
  if (all.length <= maxQuestions && (maxPromptTokens === Infinity || promptTokens(state, questions) <= maxPromptTokens)) return [all];
  const room = maxPromptTokens - promptTokens(state, {});
  const cost = all.map(n => questionTokens(n, questions[n]));
  const total = cost.reduce((s, x) => s + x, 0);
  const fits = (a: number, b: number) => b - a == 1 || (b - a <= maxQuestions && cost.slice(a, b).reduce((s, x) => s + x, 0) <= room);
  for (let k = Math.max(2, Math.ceil(all.length / maxQuestions), Math.ceil(total / Math.max(1, room))); k < all.length; k++) {
    // k parts: a cut where the running estimate passes each j/k of the total, or every ceil(n/k) questions
    const cuts = [0];
    for (let i = 0, acc = 0; i < all.length - 1; i++) {
      acc += cost[i];
      if (cuts.length < k && (acc >= total * cuts.length / k || i + 1 - cuts[cuts.length - 1] >= Math.ceil(all.length / k))) cuts.push(i + 1);
    }
    cuts.push(all.length);
    if (cuts.every((c, j) => !j || fits(cuts[j - 1], c))) return cuts.slice(1).map((c, j) => all.slice(cuts[j], c));
  }
  return all.map(n => [n]);
}

const pick = (questions: any, names: string[]) => Object.fromEntries(names.map(n => [n, questions[n]]));
const sum = (a: any, b: any): any => {
  if (typeof a == 'number' && typeof b == 'number') return a + b;
  if (a && b && typeof a == 'object' && typeof b == 'object' && !Array.isArray(a)) {
    const out: any = {...a};
    for (const k of Object.keys(b)) out[k] = k in a ? sum(a[k], b[k]) : b[k];
    return out;
  }
  return a ?? b;
};
/** the replies of a split decision as one: `answers` merged by name, `usage` summed, the rest (`model`) of the first */
export const combineDecisions = (bodies: any[]) => bodies.length == 1 ? bodies[0] : bodies.reduce((a, b) => ({
  ...b, ...a,
  answers: {...a?.answers, ...b?.answers},
  ...((a?.usage || b?.usage) && {usage: sum(a?.usage, b?.usage)}),
}));
/**
 * The reactive split: a request a server rejects as too large (HTTP 400 or 413 whose body mentions
 * tokens, fields, context, a limit, or "too long / many / large") is sent again as two halves of its
 * questions (the fetch driver: at most 3 times deep). Anything else: null (the error stands).
 */
const TOO_LARGE = /token|field|context|limit|exceed|too (long|many|large)/i;
export const splitDecision = (req: any, error: any) => {
  if (error?.status != 400 && error?.status != 413) return null;
  if (!TOO_LARGE.test(text(error.body ?? ''))) return null;
  const qs = req?.json?.questions;
  const n = Array.isArray(qs) ? qs.length : Object.keys(qs || {}).length;
  if (n < 2) return null;
  const half = (a: number, b: number) => ({...req, json: {...req.json, questions: Array.isArray(qs) ? qs.slice(a, b) : pick(qs, Object.keys(qs).slice(a, b))}});
  return [half(0, n >> 1), half(n >> 1, n)];
};
/**
 * A decision request over the limits becomes a fetch-driver batch (sub-requests in parallel, one
 * merged reply); every request can be halved when a server rejects it as too large. `split: false`:
 * neither. `json` stays the whole request (what tests and `t.requests` see).
 */
const DEFAULT_MAX_QUESTIONS = 64;
function splitting(build: (o: any) => any) {
  return ({maxQuestions = DEFAULT_MAX_QUESTIONS, maxPromptTokens = Infinity, split = true, ...o}: any = {}) => {
    const req = build(o);
    if (split === false) return req;
    const parts = splitQuestions(o.state, o.questions, Math.max(1, maxQuestions), maxPromptTokens);
    const sub = (names: string[]) => {
      const {url, method, json, parse} = build({...o, questions: pick(o.questions, names)});
      return parse ? {url, method, json, parse} : {url, method, json};
    };
    return {...req, ...(parts.length > 1 && {batch: parts.map(sub)}), combine: combineDecisions, split: splitDecision};
  };
}

const text = (x: any) => typeof x == 'string' ? x : JSON.stringify(x);
// the dictionary form takes base64 files; OpenAI takes data URLs (the type from the magic bytes)
const dataUrl = (b64: string) => b64.startsWith('data:') ? b64
  : `data:image/${b64.startsWith('/9j/') ? 'jpeg' : b64.startsWith('UklGR') ? 'webp' : 'png'};base64,${b64}`;

/** the questions in OpenAI's array form */
export const toOpenAI = (questions: any) => Object.keys(questions || {}).map(name => {
  const q = questions[name];
  const c = q.criteria;
  const instructions = text(q.instructions);
  if (q.type == 'choice') {
    return {type: 'choice', name, instructions,
      choices: Object.keys(c).map(value => c[value] == null ? {value} : {value, description: c[value]})};
  }
  if (q.type == 'score') return {type: 'score', name, instructions, levels: c.map((d: string) => ({label: d, description: d}))};
  // a predicate has no criteria: they go into the instructions
  return {type: 'predicate', name,
    instructions: c ? `${instructions}\nTrue: ${c.true}\nFalse: ${c.false}` : instructions};
});

// a refusal (or a type this mapping doesn't know) keeps its fields but `name`
const withoutName = ({name, ...a}: any) => a;

const toMap = (list: any[], k: string) => {
  const out: any = {};
  (list || []).forEach(p => { out[String(p[k])] = p.probability; });
  return out;
};

/** an OpenAI Decisions reply in the dictionary form */
export const fromOpenAI = (reply: any) => {
  if (!reply || !Array.isArray(reply.answers)) return reply;
  const answers: any = {};
  reply.answers.forEach((a: any) => {
    const {type, name} = a;
    answers[name] = type == 'predicate' ? {type: 'noul', noul: a.probability}
      : type == 'choice' ? {type, choice: a.choice, probabilities: toMap(a.probabilities, 'value'), confidence: a.confidence}
      : type == 'score' ? {type, score: a.score,
        legend: Object.fromEntries((a.probabilities || []).map((p: any) => [String(p.value), p.label])),
        probabilities: toMap(a.probabilities, 'value'), confidence: a.confidence}
      : withoutName(a);
  });
  return {...reply, answers};
};

const parseOpenAI = async (res: any) => fromOpenAI(await res.json());

/** the same questions as an OpenAI Decisions request; the reply arrives in the dictionary form */
function openai({url = '/api/decide', model, state, questions, images, ...rest}: any = {}) {
  const input = images && images.length
    ? [{role: 'user', content: [{type: 'input_text', text: text(state)},
      ...images.map((b: string) => ({type: 'input_image', image_url: dataUrl(b)}))]}]
    : text(state);
  return {url, method: 'POST', json: {model, input, questions: toOpenAI(questions)}, parse: parseOpenAI, ...rest};
}

/** the dictionary-form request (TypeSafe, Ollama, OpenRouter, AI Gateway); `decide.openai()`: the same as an OpenAI Decisions request */
export const decide = /*#__PURE__*/ Object.assign(splitting(dictionary), {openai: splitting(openai)})
