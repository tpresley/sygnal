import { jsx as _jsx, jsxs as _jsxs } from "sygnal/jsx-runtime";
import { pager } from 'sygnal';
export function TaskList({ state }) {
    const { offset, pageSize, page, hasPrev, hasNext } = state.pager;
    return (_jsxs("div", { children: [_jsx("ul", { children: state.tasks.slice(offset, offset + pageSize).map(task => _jsx("li", { children: task.title })) }), _jsx("button", { className: "older", disabled: !hasPrev, children: "Older" }), _jsx("span", { className: "page", children: page + 1 }), _jsx("button", { className: "newer", disabled: !hasNext, children: "Newer" })] }));
}
TaskList.initialState = { tasks: Array.from({ length: 25 }, (_, i) => ({ id: i + 1, title: 'Task ' + (i + 1) })) };
TaskList.uses = { pager: pager({ pageSize: 10, next: '.newer', prev: '.older' }) };
