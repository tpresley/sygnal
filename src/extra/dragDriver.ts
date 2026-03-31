import xs, {Stream} from 'xstream';

export interface DragConfig {
  category: string;
  draggable?: string;
  dropZone?: string;
  accepts?: string;
  dragImage?: string;
}

// ─── Enriched DND Event Streams ──────────────────────────────────────────────

export interface EnrichedDragStream<T = any> extends Stream<T> {
  /** Extract a `data-*` attribute value from the payload's element/dataset.
   *  Optional transform fn: `.data('id', Number)` */
  data(name: string): EnrichedDragStream<string | undefined>;
  data<R>(name: string, fn: (val: string | undefined) => R): EnrichedDragStream<R>;

  /** Extract the dragged element (dragstart) or dropZone element (drop) */
  element(): EnrichedDragStream<Element | null>;
  element<R>(fn: (el: Element | null) => R): EnrichedDragStream<R>;
}

/**
 * Adds chainable convenience methods to a DND event stream,
 * mirroring the DOM driver's `enrichEventStream` pattern.
 *
 *   DND.dragstart('task').data('taskId')
 *   DND.dragstart('task').data('taskId', Number)
 *   DND.drop('lane').data('laneId')
 *   DND.dragstart('task').element()
 */
function enrichDragStream(stream$: any): any {
  // .data(name, fn?) — extract dataset[name] from dragstart payload,
  // or dropZone.dataset[name] from drop payload
  stream$.data = function data(name: string, fn?: (val: any) => any): any {
    const mapped = stream$.map((e: any) => {
      // dragstart payload: { element, dataset }
      // drop payload: { dropZone, insertBefore }
      const val = e?.dataset?.[name]
        ?? (e?.dropZone as HTMLElement)?.dataset?.[name]
        ?? (e?.element as HTMLElement)?.dataset?.[name]
      return fn ? fn(val) : val
    });
    return enrichDragStream(mapped);
  }

  // .element(fn?) — extract the primary element from the payload
  stream$.element = function element(fn?: (el: any) => any): any {
    const mapped = stream$.map((e: any) => {
      const el = e?.element ?? e?.dropZone ?? null
      return fn ? fn(el) : el
    });
    return enrichDragStream(mapped);
  }

  return stream$
}

// ─── DND Source Interfaces ───────────────────────────────────────────────────

export interface DragSourceEvents {
  events(eventType: string): EnrichedDragStream<any>;
}

export interface DragSource {
  select(category: string): DragSourceEvents;
  dragstart(category: string): EnrichedDragStream<any>;
  dragend(category: string): Stream<any>;
  drop(category: string): EnrichedDragStream<any>;
  dragover(category: string): Stream<any>;
  dispose(): void;
}

// ─── Driver Factory ──────────────────────────────────────────────────────────

export function makeDragDriver(): (sink$: Stream<any>) => DragSource {
  return function dragDriver(sink$: Stream<any>): DragSource {
    const categories = new Map<string, DragConfig>();
    const bus = new EventTarget();
    const domListeners: Array<[string, EventListener]> = [];
    let draggingCategory: string | null = null;

    const register = (config: any) => {
      if (!config?.category) return;
      const existing = categories.get(config.category) ?? {};
      categories.set(config.category, {...existing, ...config});
    };

    sink$.subscribe({
      next(incoming: any) {
        const items = incoming?.configs ?? (Array.isArray(incoming) ? incoming : [incoming]);
        items.forEach(register);
      },
      error() {},
      complete() {},
    });

    const emit = (name: string, detail: any) =>
      bus.dispatchEvent(new CustomEvent(name, {detail}));

    const on = (type: string, fn: EventListener) => {
      document.addEventListener(type, fn);
      domListeners.push([type, fn]);
    };

    on('dragstart', (e: Event) => {
      const de = e as DragEvent;
      for (const [category, config] of categories) {
        if (!config.draggable) continue;
        const el = (de.target as Element).closest(config.draggable);
        if (!el) continue;
        draggingCategory = category;
        de.dataTransfer!.effectAllowed = 'move';

        if (config.dragImage) {
          const imgEl = el.closest(config.dragImage);
          if (imgEl) {
            const rect = imgEl.getBoundingClientRect();
            de.dataTransfer!.setDragImage(imgEl, de.clientX - rect.left, de.clientY - rect.top);
          }
        }

        emit(`${category}:dragstart`, {element: el, dataset: {...(el as HTMLElement).dataset}});
        return;
      }
    });

    on('dragend', () => {
      if (!draggingCategory) return;
      emit(`${draggingCategory}:dragend`, null);
      draggingCategory = null;
    });

    on('dragover', (e: Event) => {
      const de = e as DragEvent;
      for (const [, config] of categories) {
        if (!config.dropZone) continue;
        if (draggingCategory && config.accepts && config.accepts !== draggingCategory) continue;
        if ((de.target as Element).closest(config.dropZone)) {
          de.preventDefault();
          return;
        }
      }
    });

    on('drop', (e: Event) => {
      const de = e as DragEvent;
      for (const [category, config] of categories) {
        if (!config.dropZone) continue;
        if (draggingCategory && config.accepts && config.accepts !== draggingCategory) continue;
        const zone = (de.target as Element).closest(config.dropZone);
        if (!zone) continue;
        de.preventDefault();

        let insertBefore: Element | null = null;
        const draggingConfig = draggingCategory ? categories.get(draggingCategory) : null;
        if (draggingConfig?.draggable) {
          insertBefore = (de.target as Element).closest(draggingConfig.draggable) ?? null;
        }

        emit(`${category}:drop`, {dropZone: zone, insertBefore});
        return;
      }
    });

    const source: DragSource = {
      select(category: string): DragSourceEvents {
        return {
          events(eventType: string): EnrichedDragStream<any> {
            const busEventName = `${category}:${eventType}`;
            let handler: ((e: Event) => void) | undefined;
            const stream$ = xs.create({
              start(listener) {
                handler = ({detail}: any) => listener.next(detail);
                bus.addEventListener(busEventName, handler);
              },
              stop() {
                if (handler) bus.removeEventListener(busEventName, handler);
              },
            });
            return enrichDragStream(stream$);
          },
        };
      },

      dragstart(category: string) { return source.select(category).events('dragstart'); },
      dragend(category: string) { return source.select(category).events('dragend'); },
      drop(category: string) { return source.select(category).events('drop'); },
      dragover(category: string) { return source.select(category).events('dragover'); },

      dispose() {
        domListeners.forEach(([type, fn]) => document.removeEventListener(type, fn));
      },
    };

    return source;
  };
}
