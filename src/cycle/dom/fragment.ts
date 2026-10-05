import {Fragment as _Fragment} from 'snabbdom/build/jsx.js';

// Tag Fragment so we can identify it even after minification mangles Function.name.
// Its own module so the JSX runtime entries (which keep snabbdom external, D188) take it
// without the rest of the snabbdom barrel
(_Fragment as any).__sygnalFragment = true;
export const Fragment = _Fragment;
