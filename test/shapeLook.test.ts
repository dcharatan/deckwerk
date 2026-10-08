// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { arrowHeadSize, shapeSvg } from '../src/shared/shapeSvg.js';
import { emptyDeck, type SlideElement } from '../src/shared/deck.js';
import { elementFromNode, slideToHtml, type MeasuredNode } from '../src/shared/htmlSlides.js';
import { curvedShadow, setCurvedShadow } from '../src/shared/shapeShadow.js';
import { renderSlide } from '../src/renderer/player/render.js';
import { applyStaticSlideState } from '../src/renderer/player/staticState.js';
import { resolveState } from '../src/shared/timeline.js';

/** Gradient fills and curved (paper) shadows on shapes. */

type Shape = Extract<SlideElement, { type: 'shape' }>;
const rect = (over: Partial<Shape> = {}): Shape => ({
  id: 'card', type: 'shape', shape: 'rect', x: 0, y: 0, w: 400, h: 200, rot: 0, z: 1, opacity: 1, class: [], style: {},
  fill: '#7b90e1', stroke: null, strokeWidth: 0, radius: 0, path: null, pathSize: null, arrowStart: false, arrowEnd: false,
  ...over,
} as Shape);

const node = (over: Partial<MeasuredNode>): MeasuredNode => ({
  tag: 'div', elementId: null, classes: [], dataset: {}, rect: { x: 0, y: 0, w: 400, h: 200 },
  rotation: 0, opacity: 1, style: {}, html: '', attrs: {}, ...over,
});

describe('gradient fills', () => {
  it('paints a linear gradient in the stored direction, from fill to `to`', () => {
    const svg = shapeSvg(rect({ fillGradient: { to: '#ec6b14', angle: 270, kind: 'linear' } }));
    expect(svg).toContain('<linearGradient id="fill-card" x1="0.5" y1="0" x2="0.5" y2="1">');
    expect(svg).toContain('<stop offset="0" stop-color="#7b90e1"/><stop offset="1" stop-color="#ec6b14"/>');
    expect(svg).toContain('fill="url(#fill-card)"');
  });

  it('runs left to right at 0 degrees, and spreads from the centre when radial', () => {
    expect(shapeSvg(rect({ fillGradient: { to: '#000', angle: 0, kind: 'linear' } })))
      .toContain('x1="0" y1="0.5" x2="1" y2="0.5"');
    expect(shapeSvg(rect({ fillGradient: { to: '#000', angle: 0, kind: 'radial' } })))
      .toContain('<radialGradient id="fill-card"');
  });

  it('stays a flat fill when there is no gradient, or nothing to start it from', () => {
    expect(shapeSvg(rect())).not.toContain('Gradient');
    expect(shapeSvg(rect({ fill: null, fillGradient: { to: '#000', angle: 0, kind: 'linear' } }))).not.toContain('Gradient');
  });

  it('survives the HTML round trip', () => {
    const shape = rect({ fillGradient: { to: '#ec6b14', angle: 315, kind: 'linear' } });
    const slide = emptyDeck('Look').slides[0];
    slide.elements.push(shape);
    const html = slideToHtml(slide, { w: 1920, h: 1080 });
    expect(html).toContain('data-fill-to="#ec6b14"');
    expect(html).toContain('data-fill-angle="315"');
    const back = elementFromNode(node({
      dataset: { element: 'shape', shape: 'rect', fill: '#7b90e1', fillTo: '#ec6b14', fillAngle: '315', fillGradient: 'linear' },
    }), 'card', 1);
    expect(back).toMatchObject({ type: 'shape', fill: '#7b90e1', fillGradient: { to: '#ec6b14', angle: 315, kind: 'linear' } });
  });
});

describe('curved shadows', () => {
  it('are read and written as --curl-* custom properties', () => {
    const style: Record<string, string> = { filter: 'blur(1px)' };
    setCurvedShadow(style, { color: 'rgba(0, 0, 0, 0.5)', blur: 14, lift: 20 });
    expect(style).toEqual({
      filter: 'blur(1px)', '--curl-color': 'rgba(0, 0, 0, 0.5)', '--curl-blur': '14px', '--curl-lift': '20px',
    });
    expect(curvedShadow(style)).toEqual({ color: 'rgba(0, 0, 0, 0.5)', blur: 14, lift: 20 });
    setCurvedShadow(style, null);
    expect(style).toEqual({ filter: 'blur(1px)' });
    expect(curvedShadow(style)).toBeNull();
  });

  it('are kept when an authored shape is imported', () => {
    const back = elementFromNode(node({
      dataset: { element: 'shape', shape: 'rect', fill: '#ffffff' },
      style: { '--curl-color': 'rgba(0,0,0,.4)', '--curl-lift': '24px', '--unrelated': 'x' },
    }), 'card', 1);
    expect(back?.style).toEqual({ '--curl-color': 'rgba(0,0,0,.4)', '--curl-lift': '24px' });
  });
});

describe('the curl class', () => {
  it('outlives the static build state, which rebuilds every class list', () => {
    const slide = emptyDeck('Look').slides[0];
    slide.elements.push(rect({ style: { '--curl-color': 'rgba(0, 0, 0, 0.5)' } }));
    const stage = document.createElement('div');
    stage.appendChild(renderSlide(slide, { resolveSrc: (src) => src }));
    expect(stage.querySelector('[data-element-id="card"]')?.classList.contains('shadow-curved')).toBe(true);
    applyStaticSlideState(stage, slide, resolveState(slide, 0));
    expect(stage.querySelector('[data-element-id="card"]')?.classList.contains('shadow-curved')).toBe(true);
  });
});

describe('arrowheads', () => {
  const arrow = (over: Partial<Shape> = {}) => rect({
    shape: 'arrow', w: 400, h: 2, fill: null, stroke: '#111111', strokeWidth: 4, arrowEnd: true, ...over,
  });
  /** Each drawn head's outline (tip first, then its corners and tail) and the line, as numbers. */
  const parts = (svg: string) => {
    const heads = [...svg.matchAll(/class="arrowhead" d="M ([^"]+) Z"/g)]
      .map((m) => m[1].split(/ L | /).map(Number));
    const line = /<line x1="([\d.-]+)" y1="[\d.-]+" x2="([\d.-]+)"/.exec(svg)?.slice(1).map(Number) ?? null;
    return { heads, line };
  };
  /** A head's length: tip to the midpoint of its base (its first and last corners). */
  const length = (h: number[]) => {
    const [tx, ty, ax, ay] = h;
    const [bx, by] = h.slice(-2);
    return Math.hypot(tx - (ax + bx) / 2, ty - (ay + by) / 2);
  };

  it('follows the line width by default, as before', () => {
    expect(arrowHeadSize(arrow())).toBe(24);
    const { heads } = parts(shapeSvg(arrow()));
    expect(heads).toHaveLength(1);
    expect(length(heads[0])).toBeCloseTo(24, 1);
  });

  it('takes an authored size, so a thick line can keep a modest head', () => {
    expect(length(parts(shapeSvg(arrow({ strokeWidth: 12, arrowSize: 40 }))).heads[0])).toBeCloseTo(40, 1);
  });

  it('never draws a head narrower than its line: at the floor the line just ends in a point', () => {
    expect(arrowHeadSize(arrow({ strokeWidth: 12, arrowSize: 4 }))).toBe(12);
    const { heads, line } = parts(shapeSvg(arrow({ strokeWidth: 12, arrowSize: 4 })));
    expect(length(heads[0])).toBeCloseTo(12, 1);
    // The head's widest point is the line's width: nothing sticks out.
    const ys = heads[0].filter((_, i) => i % 2 === 1);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(12, 1);
    expect(line![1]).toBeCloseTo(400 - 12 - 1, 1);
  });

  it('puts the tip on the endpoint and stops the line just behind the head, not under it', () => {
    // A thick line under a small head: the line used to run on to the tip and show past the head.
    const { heads, line } = parts(shapeSvg(arrow({ strokeWidth: 20, arrowSize: 60, arrowStart: true })));
    const [end, start] = [heads.find((h) => h[0] > 200)!, heads.find((h) => h[0] < 200)!];
    expect(end[0]).toBeCloseTo(400, 1);
    expect(start[0]).toBeCloseTo(0, 1);
    // Into each head's 2px tail, line-wide, so no gap and nothing past the base.
    expect(line).toEqual([61, 339]);
    // The tail's back corners: 2px behind the base at 340, exactly the line's 20px wide.
    expect(end.slice(6, 10)).toEqual([338, 11, 338, -9]);
  });

  it("points a curved arrow's head along the curve, its line trimmed along the curve", () => {
    const curved = arrow({ x: 0, y: 0, control: { x: 200, y: -200 } });
    const svg = shapeSvg(curved);
    expect(svg).toContain(' Q ');
    const [head] = parts(svg).heads;
    expect(head[0]).toBeCloseTo(400, 1);
    expect(head[1]).toBeCloseTo(1, 1);
    // Coming down from the bend, the base is above-left of the tip.
    expect((head[3] + head[5]) / 2).toBeLessThan(head[1]);
    const end = /Q [\d.-]+ [\d.-]+ ([\d.-]+) ([\d.-]+)"/.exec(svg)!.slice(1).map(Number);
    expect(Math.hypot(400 - end[0], 1 - end[1])).toBeCloseTo(24 + 1, 0);
    // The end without a head keeps its round cap.
    expect(svg).toContain('<circle cx="0" cy="1" r="2"');
  });

  it('shares a short line between its heads instead of crossing them', () => {
    const { heads, line } = parts(shapeSvg(arrow({ w: 60, strokeWidth: 20, arrowStart: true })));
    expect(heads.map(length)).toEqual([expect.closeTo(30, 1), expect.closeTo(30, 1)]);
    expect(line === null || line[1] <= line[0] + 25).toBe(true);
  });

  it('round-trips through the authoring HTML, and stays absent when unset', () => {
    const deck = emptyDeck('Arrows');
    deck.slides[0].elements = [arrow({ arrowSize: 30 }), arrow({ id: 'plain' })];
    const html = slideToHtml(deck.slides[0], { w: 1920, h: 1080 });
    expect(html).toContain('data-arrow-size="30"');
    expect(html.match(/data-arrow-size/g)).toHaveLength(1);
    const back = elementFromNode(node({ dataset: { element: 'shape', shape: 'arrow', arrowSize: '30' } }), 'a', 1);
    expect(back).toMatchObject({ arrowSize: 30 });
    const bare = elementFromNode(node({ dataset: { element: 'shape', shape: 'arrow' } }), 'b', 1);
    expect('arrowSize' in bare!).toBe(false);
  });
});
