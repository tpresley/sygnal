import xs, {Stream} from './extra/xstreamCompat';
import {dropRepeats} from './extra/xstreamExtras';
import {h} from './cycle/dom/index';
import {fail} from './extra/diagnostics/legacy';
import {uidPart} from './shared';


interface SwitchableOptions {
  switched?: string | string[];
  stateSourceName?: string;
}

const NAME_FIX = 'Pass a stream, a state key string, or a state => name function';

export default function switchable(
  factories: Record<string, (sources: any) => any>,
  name$: any,
  initial: string,
  opts: SwitchableOptions = {}
): (sources: any) => any {
  const {switched = ['DOM'], stateSourceName = 'STATE'} = opts;
  const nameType = typeof name$;

  if (!name$) fail('SYG419', 'switchable', "Missing 'name$' parameter", NAME_FIX);
  if (
    !(
      nameType === 'string' ||
      nameType === 'function' ||
      name$ instanceof Stream
    )
  ) {
    fail('SYG419', 'switchable', `Invalid 'name$' parameter: got ${nameType}`, NAME_FIX);
  }

  // D83: each value is a name or a [name, instance] pair; equal pairs are repeats
  const keys = (s$: any) => s$
    .map((v: any) => [].concat(v))
    .filter((k: any) => typeof k[0] === 'string')
    .compose(dropRepeats((a: any, b: any) => a[0] === b[0] && a[1] === b[1]))
    .startWith([initial])
    .remember();
  if (name$ instanceof Stream) {
    const withInitial$ = keys(name$);
    return (sources: any) =>
      _switchable(factories, sources, withInitial$, switched, stateSourceName);
  } else {
    const mapFunction =
      (nameType === 'function' && (name$ as (state: any) => string)) ||
      ((state: any) => state[name$ as string]);
    return (sources: any) => {
      const state$ =
        sources &&
        (
          (typeof stateSourceName === 'string' && sources[stateSourceName]) ||
          sources.STATE ||
          sources.state
        ).stream;
      if (!(state$ instanceof Stream))
        fail('SYG607', 'switchable', `State source '${stateSourceName}' not found`, 'Pass the state source in sources, or set stateSourceName');
      return _switchable(factories, sources, keys(state$.map(mapFunction)), switched, stateSourceName);
    };
  }
}

function _switchable(
  factories: Record<string, (sources: any) => any>,
  sources: any,
  key$: any,
  switched: string | string[] = ['DOM'],
  stateSourceName: string = 'STATE'
): Record<string, any> {
  if (typeof switched === 'string') switched = [switched];

  // R4-1: every page keeps the full state source (reducers, sink snapshots and .context stay
  // current while hidden); only rendering waits. The page and its descendants (who inherit
  // sources.__switchPage) skip renders while hidden (G-121) and render the latest parameters
  // when shown; `stale` says one was skipped (R4-10). Nested: shown only if the outer page is.
  // D85: while hidden they also declare only the `background` entries of their statics.
  const outer = sources.__switchPage;
  const pages: Record<string, any> = {};
  // D83: a page shown with another instance than the one it was last shown with is re-created
  // (the old one is disposed first, so its DISPOSE output still goes out); a page never shown
  // adopts the instance it is first shown with
  const name$ = key$
    .map(([n, i]: any) => {
      const p = pages[n];
      if (p) {
        if (p.i !== undefined && p.i !== i) {
          p.sinks.__dispose?.();
          p.sinks = p.make();
          p.out = undefined;
          p.re$.shamefullySendNext(0);
        }
        p.i = i;
      }
      return n;
    })
    .remember();
  const st = sources[stateSourceName];
  const all = Object.entries(factories).map(([name, factory]) => {
    const page: any = (pages[name] = {re$: xs.create()});
    // an outer page re-renders for this one only if this one is current here
    page.mark = () => { page.stale = true; if (outer && page.own && !outer.shown) outer.mark(); };
    page.shown$ = xs.combine(name$, outer ? outer.shown$ : xs.of(true))
      .map(([n, o]: any) => (page.shown = (page.own = n == name) && o))
      .remember();
    // `state` stays as the marker inspect() uses for a Switchable's components
    // PLAN-4 GS-9: each page's uid is the Switchable's + the page name
    const u = sources.__uid + '-' + uidPart(name);
    page.make = () => factory(st ? {...sources, __switchPage: page, __uid: u, state: st, [stateSourceName]: st} : {...sources, __switchPage: page, __uid: u});
    page.sinks = page.make();
    return page;
  });
  // the page's sink `n` of its current instance (re-subscribed when the page is re-created)
  const follow = (page: any, n: string) =>
    page.re$.startWith(0).map(() => page.sinks[n] || xs.never()).flatten();

  // G-120: forward every sink a component produces, not just the ones that are also sources
  // (PARENT). READY stays out: the parent treats the switchable as ready, as before.
  const names = new Set(Object.keys(sources));
  all.forEach((p) => Object.keys(p.sinks).forEach((n) => names.add(n)));
  // G-121: keep each component's switched sinks (DOM) subscribed for the switchable's
  // lifetime. Unsubscribed, a hidden page's stream chain is torn down one setTimeout per
  // operator; switching back mid-teardown restarts it half-way, it never re-emits, and the
  // switchable stays on the previous page. Kept alive, switching emits the page's last value.
  const keepAlive: Array<[any, any]> = [];
  const switchedSinks = [...names].reduce<Record<string, any>>(
    (obj, sinkName) => {
      if (sinkName.startsWith('__') || sinkName === 'READY') return obj;
      const defined = all.filter((p) => p.sinks[sinkName] !== undefined);
      if ((switched as string[]).includes(sinkName)) {
        const live = new Map<any, any>();
        defined.forEach((page) => {
          // a render while shown is the fresh one
          const listener = {next(v: any) { page.out = v; if (page.shown) page.stale = false; }, error() {}, complete() {}};
          const s = follow(page, sinkName);
          live.set(page, s);
          s.addListener(listener);
          keepAlive.push([s, listener]);
        });
        obj[sinkName] = name$
          .map((newComponentName: string) => {
            const p = pages[newComponentName], s = live.get(p);
            if (!s) return xs.never();
            // R4-10: the last output is current unless a render was skipped while the page was
            // hidden; then wait for the fresh one instead of showing the old content (at most
            // 100ms: then the last output, so a switch can't get stuck). A re-created page has
            // no output yet: it waits for its first render
            return p.out === undefined ? s : !p.stale ? s.startWith(p.out)
              : xs.merge(s, xs.periodic(100).take(1).filter(() => p.stale).map(() => p.out));
          })
          .flatten()
          .remember()
          .startWith(undefined);
      } else {
        obj[sinkName] = xs.merge(...defined.map((p) => follow(p, sinkName)));
      }
      return obj;
    },
    {}
  );
  // B-024: every factory was instantiated above; dispose them all with the switchable
  switchedSinks.__dispose = () => {
    keepAlive.forEach(([stream, listener]) => stream.removeListener(listener));
    all.forEach((p) => p.sinks.__dispose?.());
  };

  return switchedSinks;
}

const Switchable = (props: any) => {
  const {children, ...sanitizedProps} = props;
  return h('switchable', {props: sanitizedProps}, children);
};
(Switchable as any).label = 'switchable';
(Switchable as any).preventInstantiation = true;

export {Switchable};
