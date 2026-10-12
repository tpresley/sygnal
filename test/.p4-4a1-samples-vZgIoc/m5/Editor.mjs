import { jsx as _jsx, jsxs as _jsxs } from "sygnal/jsx-runtime";
import { undo } from 'sygnal';
export function Editor({ state }) {
    return (_jsxs("div", { children: [_jsxs("label", { children: ["Note ", _jsx("textarea", { className: "note", value: state.doc.text })] }), _jsx("button", { className: "undo", disabled: !state.history.canUndo, children: "Undo" }), _jsx("button", { className: "redo", disabled: !state.history.canRedo, children: "Redo" })] }));
}
Editor.initialState = { doc: { text: '' } };
Editor.uses = { history: undo({ key: 'doc', undo: '.undo', redo: '.redo' }) };
Editor.intent = ({ DOM }) => ({ TYPE: DOM.input('.note').value() });
Editor.model = { TYPE: (state, text) => ({ ...state, doc: { ...state.doc, text } }) };
