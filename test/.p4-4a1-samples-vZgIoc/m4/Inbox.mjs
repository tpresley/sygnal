import { jsx as _jsx } from "sygnal/jsx-runtime";
import { selection, isSelected } from 'sygnal';
const pick = (state, id) => isSelected(state.sel, id);
export function Inbox({ state }) {
    return (_jsx("ul", { children: state.mails.map(mail => (_jsx("li", { children: _jsx("button", { className: "pick", "data-id": mail.id, "aria-pressed": String(pick(state, mail.id)), children: mail.subject }) }))) }));
}
Inbox.initialState = { mails: [{ id: 1, subject: 'Lunch?' }, { id: 2, subject: 'Invoice' }] };
Inbox.uses = { sel: selection({ multi: true, item: '.pick', from: 'mails' }) };
