import xs, {Stream} from 'xstream';

export interface DragConfig {
  category: string;
  draggable?: string;
  dropZone?: string;
  accepts?: string;
  dragImage?: string;
}

export interface DragSourceEvents {
  events(eventType: string): Stream<any>;
}

export interface DragSource {
  select(category: string): DragSourceEvents;
  dragstart(category: string): Stream<any>;
  dragend(category: string): Stream<any>;
  drop(category: string): Stream<any>;
  dragover(category: string): Stream<any>;
  dispose(): void;
}

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
          events(eventType: string): Stream<any> {
            const busEventName = `${category}:${eventType}`;
            let handler: ((e: Event) => void) | undefined;
            return xs.create({
              start(listener) {
                handler = ({detail}: any) => listener.next(detail);
                bus.addEventListener(busEventName, handler);
              },
              stop() {
                if (handler) bus.removeEventListener(busEventName, handler);
              },
            });
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
