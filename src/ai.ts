// 'sygnal/ai' (PLAN-6, D240): LLM chat, decisions and the agent layer. The code lives in the main
// package (src/extra/ai/, D253); this entry re-exports it from the external 'sygnal' (rollup maps
// './index' to it), so an app has one copy of the internals (G-581) and the core bundle gains 0 B.
// Keep this list in sync with src/extra/ai/index.ts and src/ai.d.ts.
export {messageText} from './index'
export {decide, choice, noul, score} from './index'
export {agentTools, toJsonSchema, parseInput, jsonSchema} from './index'
// L-1 (1-L)
export {makeChatDriver, outputJsonSchema} from './index'
// A-2 (2-W)
export {experimentalExposeWebMcp} from './index'
// L-3 (2-C)
export {chat} from './index'
// L-2 (2-T)
export {openResponses, chatCompletions, uiMessageStream, chromePrompt, encodeOpenResponses} from './index'
// M-2 / M-3 (3-M)
export {answers, commandBar} from './index'
// L-2 (3-W2)
export {anthropicMessages, agui, fromAISDK, strictSchemas} from './index'
