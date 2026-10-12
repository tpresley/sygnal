import { jsx as _jsx, jsxs as _jsxs } from "sygnal/jsx-runtime";
// AddTodo.jsx
import { ABORT, controls } from 'sygnal';
export const { Draft, Add } = controls({ Draft: 'input', Add: 'button' });
export function AddTodo({ state }) {
    return (_jsxs("form", { children: [_jsxs("label", { children: ["New todo ", _jsx(Draft, { value: state.draft })] }), _jsx(Add, { type: "button", children: "Add" }), _jsx("ul", { children: state.todos.map((todo) => _jsx("li", { children: todo })) })] }));
}
AddTodo.initialState = { draft: '', todos: [] };
AddTodo.intent = ({ DOM }) => ({
    DRAFT: DOM.input(Draft).value(),
    ADD: DOM.click(Add),
});
AddTodo.model = {
    DRAFT: (state, draft) => ({ ...state, draft }),
    ADD: (state) => (state.draft ? { ...state, todos: [...state.todos, state.draft], draft: '' } : ABORT),
};
