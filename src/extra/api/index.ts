// sygnal/api's entry: contract.ts (no diagnostics import, so sygnal/vite can bundle it without a
// second copy of the diagnostics state) plus contractFetch, which reports SYG690.
import {warn} from '../diagnostics/legacy';
import {SKEW_HEADER, SERVER_HASH} from './contract';

export * from './contract';

/**
 * A fetch for the drivers (`makeFetchDriver({ fetch: contractFetch() })`, `makeSocketDriver({
 * fetch })`) that notices skew answers: SYG690 once, and `onSkew({ server })` on each.
 */
export function contractFetch({fetch: f, onSkew}: {fetch?: typeof fetch; onSkew?: (info: {server: string | null; url: string}) => void} = {}) {
  let told = false;
  return async (input: any, init?: any) => {
    const res = await (f || globalThis.fetch)(input, init);
    if (res.status === 409 && res.headers.get(SKEW_HEADER)) {
      const info = {server: res.headers.get(SERVER_HASH), url: String(input?.url ?? input)};
      if (!told) {
        told = true;
        warn('SYG690', undefined, `sygnal/api: the server's API contract (${info.server}) is not the one this client was built with`, 'Reload the app (onSkew can prompt the user); a stale tab keeps failing with CONTRACT_SKEW', info);
      }
      onSkew?.(info);
    }
    return res;
  };
}
