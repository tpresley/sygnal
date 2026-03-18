export default function exactState<S>(): (state: S) => S {
  return (state: S) => state;
}
