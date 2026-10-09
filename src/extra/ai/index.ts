/*
 * PLAN-6 (D240, D253): the implementation behind 'sygnal/ai'. It lives in the main package so
 * there is one copy of the reply helpers and the diagnostics module (G-581) and renderComponent's
 * fakes can use it; src/index.ts exports these names and src/ai.ts re-exports them from the
 * external 'sygnal', which is the documented import. Every module here must be side-effect free
 * so apps that don't use it pay 0 B (the size gate).
 *
 * Layout (Phase 1): messages.ts (L-1 message helpers), chat/ (L-1 driver, L-2 transports),
 * agent/ (A-1 layer), schema/ (A-1 input contract), decide.ts (M-1).
 */
export {messageText} from './messages'
export {decide, choice, noul, score} from './decide'
// A-1 (1-A): the agent layer and the schema input contract
export {agentTools} from './agent/index'
export {toJsonSchema, parseInput} from './schema/index'
export {jsonSchema} from './schema/jsonSchema'
// L-1 (1-L): the chat driver; outputJsonSchema is the structured-output seam transports use (1-A fills it)
export {makeChatDriver} from './chat/driver'
export {outputJsonSchema} from './chat/output'
// A-2 (2-W): WebMCP (experimental, D241)
export {experimentalExposeWebMcp} from './webmcp'
// L-3 (2-C): the chat behavior
export {chat} from './chat/behavior'
// L-2 (2-T): transports, wave 1 (D248), each its own module (tree-shaken), and the Open Responses
// event encoder (D273)
export {openResponses} from './transports/openResponses'
export {chatCompletions} from './transports/chatCompletions'
export {uiMessageStream} from './transports/uiMessageStream'
export {chromePrompt} from './transports/chromePrompt'
export {encodeOpenResponses} from './transports/encodeOpenResponses'
// M-2 / M-3 (3-M): decision reply fixtures and the command bar
export {answers} from './answers'
export {commandBar} from './commandBar'
// L-2 (3-W2): transports, wave 2 (D248), and the opt-in strict layer (D285)
export {anthropicMessages} from './transports/anthropicMessages'
export {agui} from './transports/agui'
export {fromAISDK} from './transports/fromAISDK'
export {strictSchemas} from './schema/strict'
