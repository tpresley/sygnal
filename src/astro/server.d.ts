export function check(Component: any): boolean;
export function renderToStaticMarkup(): { html: string; attrs: Record<string, any> };
export const supportsAstroStaticSlot: boolean;
declare const renderer: {
  check: typeof check;
  renderToStaticMarkup: typeof renderToStaticMarkup;
  supportsAstroStaticSlot: typeof supportsAstroStaticSlot;
};
export default renderer;
