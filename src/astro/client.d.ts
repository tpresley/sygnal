declare const clientEntrypoint: (element: Element & { __sygnal?: any }) => (
  Component: any,
  props: Record<string, any>,
  slotted: Record<string, any>,
  metadata: { client?: string }
) => Promise<void>;

export default clientEntrypoint;
