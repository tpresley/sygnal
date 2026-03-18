import * as xstreamNamespace from 'xstream';

export function resolveInteropDefault(namespaceValue: any): any {
  if (
    namespaceValue &&
    namespaceValue.default &&
    namespaceValue.default.default &&
    typeof namespaceValue.default.default === 'function'
  ) {
    return namespaceValue.default.default;
  }

  if (namespaceValue && namespaceValue.default) {
    return namespaceValue.default;
  }

  return namespaceValue;
}

function getXs(namespaceValue: any): any {
  const value = resolveInteropDefault(namespaceValue);

  if (
    value &&
    value.default &&
    typeof value.default.create === 'function'
  ) {
    return value.default;
  }

  return value;
}

const xs = getXs(xstreamNamespace);
const Stream =
  (xstreamNamespace as any).Stream ||
  ((xstreamNamespace as any).default && (xstreamNamespace as any).default.Stream) ||
  (xs && xs.Stream);

export {Stream};
export default xs;
