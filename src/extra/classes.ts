type ClassArg = string | string[] | Record<string, boolean | (() => boolean)>;

/**
 * Return a validated and properly separated string of CSS class names from
 * any number of strings, arrays, and objects.
 */
export default function classes(...args: ClassArg[]): string {
  return args
    .reduce<string[]>((acc, arg) => {
      if (typeof arg === 'string' && !acc.includes(arg)) {
        acc.push(...classes_processString(arg));
      } else if (Array.isArray(arg)) {
        acc.push(...classes_processArray(arg));
      } else if (typeof arg === 'object') {
        acc.push(...classes_processObject(arg));
      }
      return acc;
    }, [])
    .join(' ');
}

function isValidClassName(className: string): boolean {
  return /^[a-zA-Z0-9-_]+$/.test(className);
}

function classes_processString(str: string): string[] {
  if (typeof str !== 'string') throw new Error('Class name must be a string');
  return str
    .trim()
    .split(' ')
    .reduce<string[]>((acc, item) => {
      if (item.trim().length === 0) return acc;
      if (!isValidClassName(item))
        throw new Error(`${item} is not a valid CSS class name`);
      acc.push(item);
      return acc;
    }, []);
}

function classes_processArray(arr: string[]): string[] {
  return arr.map(classes_processString).flat();
}

function classes_processObject(
  obj: Record<string, boolean | (() => boolean)>
): string[] {
  return Object.entries(obj)
    .filter(([_key, predicate]) =>
      typeof predicate === 'function' ? predicate() : !!predicate
    )
    .map(([key, _]) => {
      const trimmed = key.trim();
      if (!isValidClassName(trimmed))
        throw new Error(`${trimmed} is not a valid CSS class name`);
      return trimmed;
    });
}
