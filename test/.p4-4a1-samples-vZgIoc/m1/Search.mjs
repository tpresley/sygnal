import { jsx as _jsx, jsxs as _jsxs } from "sygnal/jsx-runtime";
import { ABORT, debounce } from 'sygnal';
function Search({ state }) {
    return _jsxs("div", { children: [_jsx("input", { className: "q", "aria-label": "Search", value: state.query }), _jsx("p", { className: "status", children: state.status }), _jsx("ul", { children: state.results.map(r => _jsx("li", { children: r.title })) })] });
}
Search.initialState = { query: '', status: '', results: [] };
Search.intent = ({ DOM }) => ({
    TYPE: DOM.input('.q').value(),
    SEARCH: DOM.input('.q').value().compose(debounce(300)).filter(q => q !== ''),
});
Search.model = {
    TYPE: {
        STATE: (state, query) => (query === '' ? { ...state, query, status: '', results: [] } : { ...state, query }),
        HTTP: (state, query) => (query === '' ? { abort: 'RESULTS' } : ABORT), // clearing cancels the request in flight
    },
    SEARCH: {
        STATE: (state) => ({ ...state, status: 'Searching…' }),
        HTTP: (state, q) => ({ url: '/api/search', query: { q }, ok: 'RESULTS', error: 'FAILED', latest: true }),
    },
    RESULTS: (state, body) => ({ ...state, status: '', results: body.results }), // ok: the parsed body
    FAILED: (state, { status, error }) => ({ ...state, status: status === 404 ? 'Not found.' : 'Search failed.', results: [] }),
};
export { Search };
