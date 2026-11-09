import xstream, {Stream} from 'xstream';

// The builds route 'xstream' through rollup.config.mjs's interop shim, so the default is the real xs
const xs: any = xstream;

export {Stream};
export default xs;
