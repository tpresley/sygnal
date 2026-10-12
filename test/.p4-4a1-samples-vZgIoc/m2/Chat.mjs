import { jsx as _jsx, jsxs as _jsxs } from "sygnal/jsx-runtime";
import { ABORT } from 'sygnal';
function Chat({ state }) {
    return _jsxs("div", { children: [_jsx("p", { className: "status", children: state.status }), _jsx("ul", { children: state.messages.map(m => _jsx("li", { children: m.text })) }), _jsx("input", { className: "draft", "aria-label": "Message", value: state.draft }), _jsx("button", { className: "send", children: "Send" }), _jsx("button", { className: "leave", children: "Leave" })] });
}
Chat.initialState = { room: 'general', status: 'connecting', messages: [], draft: '' };
Chat.connections = (state) => ({
    room: state.room && { socket: `/ws/rooms/${state.room}`, message: 'RECEIVED', open: 'CONNECTED', close: 'DROPPED',
        reconnect: { delayMs: 1000, maxDelayMs: 1000, jitter: false } }, // fixed 1 s retry (default: 500 ms doubling to 10 s, ±20%)
});
Chat.intent = ({ DOM }) => ({ DRAFT: DOM.input('.draft').value(), SEND: DOM.click('.send'), LEAVE: DOM.click('.leave') });
Chat.model = {
    DRAFT: (state, draft) => ({ ...state, draft }),
    SEND: {
        STATE: (state) => (state.draft.trim() ? { ...state, draft: '' } : ABORT),
        WS: (state) => (state.draft.trim() ? { to: 'room', json: { text: state.draft } } : ABORT), // queued while (re)connecting
    },
    LEAVE: (state) => ({ ...state, room: null, status: 'offline', messages: [] }), // closes it: no DROPPED
    RECEIVED: (state, msg) => ({ ...state, messages: [...state.messages, msg] }), // the JSON-parsed frame
    CONNECTED: (state) => ({ ...state, status: 'online' }), // data: { reconnected }
    DROPPED: (state, { willReconnect }) => ({ ...state, status: willReconnect ? 'reconnecting' : 'offline' }), // { code, reason, willReconnect }
};
export { Chat };
