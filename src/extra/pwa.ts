import xs, {Stream} from 'xstream';
import {adapt} from '../cycle/run/adapt';

// ── Types ────────────────────────────────────────────────────

export interface ServiceWorkerSource {
  select(type?: string): any;
}

export interface ServiceWorkerCommand {
  action: 'skipWaiting' | 'postMessage' | 'unregister';
  data?: any;
}

export interface ServiceWorkerOptions {
  scope?: string;
}

export interface InstallPrompt {
  select(type: 'beforeinstallprompt' | 'appinstalled'): any;
  prompt(): Promise<any> | undefined;
}

// ── makeServiceWorkerDriver ──────────────────────────────────

function trackWorker(worker: ServiceWorker, events: EventTarget) {
  const emit = (type: string, data: any) =>
    events.dispatchEvent(new CustomEvent('data', {detail: {type, data}}));

  worker.addEventListener('statechange', () => {
    if (worker.state === 'installed') emit('installed', true);
    if (worker.state === 'activated') emit('activated', true);
  });

  if (worker.state === 'installed') emit('waiting', worker);
  if (worker.state === 'activated') emit('activated', true);
}

export function makeServiceWorkerDriver(
  scriptUrl: string,
  options: ServiceWorkerOptions = {},
): (sink$: Stream<ServiceWorkerCommand>) => ServiceWorkerSource {
  return function serviceWorkerDriver(sink$: Stream<ServiceWorkerCommand>): ServiceWorkerSource {
    const events = new EventTarget();

    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker
        .register(scriptUrl, {scope: options.scope})
        .then((reg) => {
          const emit = (type: string, data: any) =>
            events.dispatchEvent(new CustomEvent('data', {detail: {type, data}}));

          if (reg.installing) trackWorker(reg.installing, events);
          if (reg.waiting) emit('waiting', reg.waiting);
          if (reg.active) emit('activated', true);

          reg.addEventListener('updatefound', () => {
            if (reg.installing) trackWorker(reg.installing, events);
          });

          navigator.serviceWorker.addEventListener('controllerchange', () => {
            emit('controlling', true);
          });

          navigator.serviceWorker.addEventListener('message', (e) => {
            emit('message', (e as MessageEvent).data);
          });
        })
        .catch((err) => {
          events.dispatchEvent(new CustomEvent('data', {detail: {type: 'error', data: err}}));
        });

      sink$.addListener({
        next: (cmd: ServiceWorkerCommand) => {
          if (cmd.action === 'skipWaiting') {
            navigator.serviceWorker.ready.then((r) => {
              if (r.waiting) r.waiting.postMessage({type: 'SKIP_WAITING'});
            });
          } else if (cmd.action === 'postMessage') {
            navigator.serviceWorker.ready.then((r) => {
              if (r.active) r.active.postMessage(cmd.data);
            });
          } else if (cmd.action === 'unregister') {
            navigator.serviceWorker.ready.then((r) => r.unregister());
          }
        },
        error: (err: any) => console.error('[SW driver] Error in sink stream:', err),
      });
    }

    return {
      select(type?: string) {
        let cb: ((e: Event) => void) | undefined;
        const in$ = xs.create<any>({
          start: (listener) => {
            cb = ({detail}: any) => {
              if (!type || detail.type === type) listener.next(detail.data);
            };
            events.addEventListener('data', cb);
          },
          stop: () => {
            if (cb) events.removeEventListener('data', cb);
          },
        });
        return adapt(in$);
      },
    };
  };
}

// ── onlineStatus$ ────────────────────────────────────────────

export function onlineStatus$(): Stream<boolean> {
  if (typeof window === 'undefined') {
    return xs.of(true);
  }

  let cleanup: (() => void) | undefined;

  return xs.create<boolean>({
    start(listener) {
      listener.next(navigator.onLine);
      const on = () => listener.next(true);
      const off = () => listener.next(false);
      window.addEventListener('online', on);
      window.addEventListener('offline', off);
      cleanup = () => {
        window.removeEventListener('online', on);
        window.removeEventListener('offline', off);
      };
    },
    stop() {
      cleanup?.();
      cleanup = undefined;
    },
  });
}

// ── createInstallPrompt ──────────────────────────────────────

export function createInstallPrompt(): InstallPrompt {
  let deferredPrompt: any = null;
  const events = new EventTarget();

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      events.dispatchEvent(new CustomEvent('data', {detail: {type: 'beforeinstallprompt', data: true}}));
    });

    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      events.dispatchEvent(new CustomEvent('data', {detail: {type: 'appinstalled', data: true}}));
    });
  }

  return {
    select(type: 'beforeinstallprompt' | 'appinstalled') {
      let cb: ((e: Event) => void) | undefined;
      const in$ = xs.create<any>({
        start: (listener) => {
          cb = ({detail}: any) => {
            if (detail.type === type) listener.next(detail.data);
          };
          events.addEventListener('data', cb);
        },
        stop: () => {
          if (cb) events.removeEventListener('data', cb);
        },
      });
      return adapt(in$);
    },

    prompt() {
      return deferredPrompt?.prompt();
    },
  };
}
