import { describe, expect, it } from 'vitest';
import { stressDoc } from '../src/model/stress';
import { exportSvg } from '../src/model/svg';
import { docOf } from './helpers';

describe('SVG export', () => {
  const d = docOf(
    { id: 'f', type: 'frame', x: 10, y: 20, w: 200, h: 100, kids: ['t'], name: 'A & B' },
    { id: 't', type: 'text', x: 5, y: 5, w: 100, h: 30, text: '<hi>\nthere' } as never,
    { id: 'e', type: 'ellipse', x: 300, y: 0, w: 40, h: 20, rotation: 45, opacity: 0.5 },
  );

  it('exports the page cropped to its content', () => {
    const svg = exportSvg(d);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    expect(svg).toContain('<clipPath id="clip-f">');
    expect(svg).toContain('data-name="A &amp; B"');
    expect(svg).toContain('&lt;hi&gt;');
    expect(svg).toContain('<ellipse transform="translate(300 0) rotate(45)" cx="20" cy="10" rx="20" ry="10"');
    expect(svg).toContain('opacity="0.5"');
  });

  it('exports a selection, keeping a frame child in its frame\'s space', () => {
    const svg = exportSvg(d, ['t']);
    expect(svg).toContain('viewBox="15 25 100 30"');
    expect(svg).toContain('<g transform="matrix(1 0 0 1 10 20)">');
    expect(svg).not.toContain('<ellipse');
  });

  it('skips hidden nodes', () => {
    const svg = exportSvg(docOf({ id: 'a', type: 'rect' }, { id: 'h', type: 'rect', x: 500, visible: false }));
    expect(svg).toContain('viewBox="0 0 100 100"');
    expect(svg.match(/<rect/g)).toHaveLength(1);
  });
});

describe('stress documents', () => {
  it('are deterministic and laid out on the shared grid', () => {
    const a = stressDoc(1000);
    expect(a.root).toHaveLength(1000);
    expect(a).toEqual(stressDoc(1000));
    expect(a.nodes.s0).toMatchObject({ type: 'rect', x: 0, y: 0, w: 30, h: 30 });
    expect(a.nodes.s1).toMatchObject({ type: 'ellipse', x: 40, y: 0 });
    expect(a.nodes.s32).toMatchObject({ x: 0, y: 40 }); // ceil(sqrt(1000)) = 32 columns
    expect(a.nodes.s5.fill).toMatch(/^#[0-9a-f]{6}$/);
  });
});
