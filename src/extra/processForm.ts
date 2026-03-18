import xs, {Stream} from 'xstream';

interface DOMSelector {
  events(eventType: string): Stream<any>;
}

interface ProcessFormOptions {
  events?: string | string[];
  preventDefault?: boolean;
}

interface FormEntries {
  event: Event;
  eventType: string;
  [key: string]: any;
}

export default function processForm(
  form: DOMSelector,
  options: ProcessFormOptions = {}
): Stream<FormEntries> {
  if (!form || typeof form.events !== 'function') {
    throw new Error(
      'processForm: first argument must have an .events() method (e.g. DOM.select(...))'
    );
  }
  let {events = ['input', 'submit'], preventDefault = true} = options;
  if (typeof events === 'string') events = [events];

  const eventStream$ = (events as string[]).map((event) => form.events(event));
  const merged$ = xs.merge(...eventStream$);

  return merged$.map((e: any) => {
    if (preventDefault) e.preventDefault();
    const formEl = e.type === 'submit' ? e.srcElement : e.currentTarget;
    const formData = new FormData(formEl);
    const entries: FormEntries = {event: e, eventType: e.type};
    const submitBtn = formEl.querySelector('input[type=submit]:focus');
    if (submitBtn) {
      const {name, value} = submitBtn;
      entries[name || 'submit'] = value;
    }
    for (const [name, value] of formData.entries()) {
      entries[name] = value;
    }
    return entries;
  });
}
