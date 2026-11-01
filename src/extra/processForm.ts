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
    // alt-renderers spike (D-AR-2): a non-DOM host's form gives its own entries
    const formData = typeof formEl.toFormData == 'function' ? formEl.toFormData() : new FormData(formEl);
    const entries: FormEntries = {event: e, eventType: e.type};
    const submitBtn = formEl.querySelector('input[type=submit]:focus');
    if (submitBtn) {
      const {name, value} = submitBtn;
      entries[name || 'submit'] = value;
    }
    for (const [name, value] of formData.entries()) {
      entries[name] = value;
    }
    // UI sweep round 3: a <select multiple> is an array of its selected values ([] when none), as
    // the form behavior's CHANGE and a multiple widget field (FormData has one entry per value, and
    // none at all when nothing is selected). Its form's controls (`elements`), so `form="id"` ones too
    // Round 4: checkboxes are a group when more than one in the form has the name (disabled ones
    // count, so disabling one doesn't change the type): an array of the checked, enabled boxes'
    // values in tree order ([] when none), FormData.getAll's; a lone checkbox stays FormData.get's.
    // A host form (no `elements`) gives its inputs
    const dom = !!formEl.elements, boxes: Record<string, any[]> = {};
    const off = (el: any) => (dom ? el.matches(':disabled') : el.disabled);
    for (const el of formEl.elements || formEl.querySelectorAll?.('input') || []) {
      if (!el.name) continue;
      if (el.type == 'checkbox') (boxes[el.name] ||= []).push(el);
      else if (el.type == 'select-multiple' && !off(el)) {
        entries[el.name] = [...el.selectedOptions].map((o: any) => o.value);
      }
    }
    for (const name in boxes) {
      const g = boxes[name];
      if (g.length > 1 && g.some((el) => !off(el))) {
        entries[name] = g.filter((el) => el.checked && !off(el)).map((el) => el.value || 'on');
      }
    }
    // the widget field contract (extra/field.ts): a field widget's value over its own named
    // fields' (they follow its value prop, which may not have caught up with a pick)
    formEl.querySelectorAll?.('*').forEach((el: any) => {
      const f = el.__sw?.f?.();
      if (f?.name && !f.disabled) entries[f.name] = f.value;
    });
    return entries;
  });
}
