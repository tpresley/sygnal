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
export function decide({url = '/api/decide', model, state, questions, images, ...rest}: any = {}) {
  const json: any = {model, state, questions};
  if (images) json.images = images;
  return {url, method: 'POST', json, ...rest};
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
decide.openai = function ({url = '/api/decide', model, state, questions, images, ...rest}: any = {}) {
  const input = images && images.length
    ? [{role: 'user', content: [{type: 'input_text', text: text(state)},
      ...images.map((b: string) => ({type: 'input_image', image_url: dataUrl(b)}))]}]
    : text(state);
  return {url, method: 'POST', json: {model, input, questions: toOpenAI(questions)}, parse: parseOpenAI, ...rest};
};
