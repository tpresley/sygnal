import { jsx as _jsx, jsxs as _jsxs } from "sygnal/jsx-runtime";
import { ABORT, defineBehavior } from 'sygnal';
const disclosure = defineBehavior({ initialState: { open: false }, intent: ({ DOM }, { toggle }) => ({ TOGGLE: DOM.click(toggle) }), model: { TOGGLE: (slice) => ({ ...slice, open: !slice.open }) } });
export function Product({ state }) {
    return (_jsxs("section", { children: [_jsx("button", { className: "more", "aria-expanded": String(state.more.open), children: "Details" }), state.more.open && _jsx("p", { children: state.text }), _jsx("p", { className: "opened", children: state.opened })] }));
}
Product.initialState = { text: 'Warm light.', opened: 0 };
Product.uses = { more: disclosure({ toggle: '.more' }) };
Product.intent = ({ DOM }) => ({ 'more.TOGGLE': DOM.keydown('document').key().filter(key => key === 'Enter') });
Product.model = { 'more.TOGGLE': (state) => (state.more.open ? { ...state, opened: state.opened + 1 } : ABORT) };
