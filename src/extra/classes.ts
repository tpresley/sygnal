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

// CSS-6: a class name is any token without whitespace (hover:bg-red-500, w-1/2, [&>a]:underline,
// w-1.5): the DOM's rule; a string or an object key may hold several, as class= takes them
function classes_processString(str: string): string[] {
  if (typeof str !== 'string') throw new Error('Class name must be a string');
  return str.split(/\s+/).filter(Boolean);
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
    .flatMap(([key, _]) => classes_processString(key));
}
