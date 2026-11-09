import xs, {Stream} from 'xstream';

// The builds route 'xstream' through rollup.config.mjs's interop shim, so the default is the real xs
export {Stream};
export default xs;
