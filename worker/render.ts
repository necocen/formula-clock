import {LiteElement} from '@mathjax/src/js/adaptors/lite/Element.js';
import type {LiteText} from '@mathjax/src/js/adaptors/lite/Text.js';
import type {LiteDocument} from '@mathjax/src/js/adaptors/lite/Document.js';
import type {MathDocument} from '@mathjax/src/js/core/MathDocument.js';
import type {Bounds,DisplayOptions,Expr,Typography} from '../types.ts';
import type {RenderInput} from './types.ts';
interface Engine {
  profile: ReturnType<typeof Display.typography>; queue: Promise<unknown>;
  document: MathDocument<LiteElement,LiteText,LiteDocument>; typography: Typography;
}
import {mathjax} from '@mathjax/src/js/mathjax.js';
import {TeX} from '@mathjax/src/js/input/tex.js';
import {SVG} from '@mathjax/src/js/output/svg.js';
import {liteAdaptor} from '@mathjax/src/js/adaptors/liteAdaptor.js';
import {RegisterHTMLHandler} from '@mathjax/src/js/handlers/html.js';
import '@mathjax/src/js/input/tex/base/BaseConfiguration.js';
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js';
import '@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js';
import '@mathjax/src/js/input/tex/html/HtmlConfiguration.js';
import {MathJaxStix2Font} from '@mathjax/mathjax-stix2-font/js/svg.js';
import {MathJaxTermesFont} from '@mathjax/mathjax-termes-font/js/svg.js';
import {MathJaxFiraFont} from '@mathjax/mathjax-fira-font/js/svg.js';
import {MathJaxModernFont} from '@mathjax/mathjax-modern-font/js/svg.js';
import {MathJaxEulerFontExtension} from '@mathjax/mathjax-euler-font-extension/js/svg.js';
import {Resvg,initWasm} from '@resvg/resvg-wasm';
import Expression from '../expression.ts';
import Display from '../display.ts';
import Share from '../share.ts';
import {COLORS,canvas,DEFAULT_BRAND} from './brand.ts';

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
// Modern is used only as the base for Euler; other profiles have separate classes.
MathJaxModernFont.addExtension(MathJaxEulerFontExtension);
const fonts = {stix2:MathJaxStix2Font,termes:MathJaxTermesFont,fira:MathJaxFiraFont,euler:MathJaxModernFont};
const engines = new Map<string,Promise<Engine>>();
const rasterOptions = {font:{loadSystemFonts:false}};
let wasmReady: Promise<void> | null;
export function initRenderer(wasm: Parameters<typeof initWasm>[0]) {
  return wasmReady ??= initWasm(wasm).catch(error => { wasmReady = null; throw error; });
}
const attributes = (node: LiteElement,values: Record<string,string | number>) => Object.entries(values).forEach(([key,value]) => adaptor.setAttribute(node,key,String(value)));
const byId = (svg: LiteElement,id: string) => adaptor.elementById(svg,id);
const xml = (node: LiteElement) => adaptor.outerHTML(node);
const box = (svg: LiteElement): Bounds => {
  const [x,y,w,h] = String(adaptor.getAttribute(svg,'viewBox')).trim().split(/\s+/).map(Number);
  if (![x,y,w,h].every(Number.isFinite) || w <= 0 || h <= 0) throw new Error('Invalid MathJax viewBox');
  return {x,y,w,h};
};

// resvg reports ink bounds in the root SVG coordinate system, before viewBox
// scaling. Preserve the complete ancestor transforms when measuring one marker.
function inkBounds(svg: LiteElement, target = svg) {
  let isolated;
  if (target === svg) isolated = adaptor.clone(svg);
  else {
    let node = target, branch = adaptor.clone(node);
    while (node !== svg) {
      node = adaptor.parent(node);
      if (!node) throw new Error('Detached MathJax marker');
      const parent = adaptor.clone(node,false);
      adaptor.append(parent,branch); branch = parent;
    }
    isolated = branch;
  }
  const bounds = box(svg);
  attributes(isolated,{width:bounds.w,height:bounds.h,color:'#000000'});
  const raster = new Resvg(xml(isolated),rasterOptions);
  let result;
  try {
    result = raster.getBBox();
    if (!result || ![result.x,result.y,result.width,result.height].every(Number.isFinite) || result.height <= 0) {
      throw new Error('Missing SVG ink bounds');
    }
    return {x:result.x,y:result.y,w:result.width,h:result.height,centerY:result.y + result.height / 2};
  } finally { result?.free(); raster.free(); }
}

async function convert(engine: Pick<Engine,'document'>, tex: string) {
  const node = await engine.document.convertPromise(tex,{display:true,em:16,ex:8,containerWidth:100000});
  if (!(node instanceof LiteElement)) throw new Error('MathJax did not produce an SVG container');
  const svg = adaptor.tags(node,'svg')[0];
  // MathJax adds empty <text data-id-align> anchors inside fractions. They are
  // layout markers; only actual text content would require an unavailable font.
  if (!svg || adaptor.tags(svg,'text').some(node => adaptor.textContent(node).length) ||
      adaptor.tags(svg,'g').some(node => adaptor.hasAttribute(node,'data-mjx-error'))) {
    throw new Error('MathJax could not outline the expression');
  }
  return svg;
}
async function engineFor(font: DisplayOptions['font'],numerals: DisplayOptions['numerals']): Promise<Engine> {
  const key = `${font}:${numerals}`;
  if (!engines.has(key)) {
    const task = (async (): Promise<Engine> => {
      const profile = Display.typography(font,numerals);
      const output = new SVG<LiteElement,LiteText,LiteDocument>({fontData:fonts[font],fontCache:'none'});
      const engine = {profile,queue:Promise.resolve(),document:mathjax.document('',{
        InputJax:new TeX({packages:['base','ams','newcommand','html'],formatError(_jax: unknown,error: Error) { throw error; }}),OutputJax:output})};
      const zero = await convert(engine,Expression.mark('probe','0',profile));
      const zeroBox = inkBounds(zero,byId(zero,'fc-probe'));
      const originalAxisEm = output.font.params.axis_height, numericAxisEm = -zeroBox.centerY / 1000;
      if (!(numericAxisEm > .15 && numericAxisEm < .55)) throw new Error('Invalid numeral axis');
      if (profile.numericAxis) output.font.params.axis_height = numericAxisEm;
      const equal = await convert(engine,Expression.relation(profile));
      const equalBox = inkBounds(equal,byId(equal,'fc-eq'));
      const typography: Typography = {profile:font,numerals,axisMode:profile.numericAxis ? 'numeric' : 'font',referenceDigit:'0',
        originalAxisEm,numericAxisEm,axisEm:output.font.params.axis_height,zeroTop:zeroBox.y,zeroBottom:zeroBox.y + zeroBox.h,
        equalCenterY:equalBox.centerY};
      return {...engine,typography};
    })().catch(error => { engines.delete(key); throw error; });
    engines.set(key,task);
  }
  return engines.get(key)!;
}
function desaturate(hex: string) {
  const rgb = hex.slice(1).match(/../g)!.map(value => parseInt(value,16));
  const luma = rgb[0] * .213 + rgb[1] * .715 + rgb[2] * .072;
  // SVG 1.1/resvg accepts integer RGB components; fractional numbers can parse
  // as an invalid color and silently become black.
  return '#' + rgb.map(value => Math.round(luma + .38 * (value - luma)).toString(16).padStart(2,'0')).join('');
}
function paint(svg: LiteElement, ast: Expr | null) {
  attributes(svg,{color:COLORS.symbols,fill:'currentColor',stroke:'currentColor','stroke-width':0});
  for (let i=0;i<6;i++) {
    const marker = byId(svg,`fc-${i < 4 ? 'd'+i : 's'+(i-4)}`);
    if (!marker || !adaptor.tags(marker,'path').length) throw new Error(`Missing clock slot ${i}`);
    let color = i < 4 ? COLORS.digits[i] : COLORS.foreground;
    if (!ast && i < 4) color = desaturate(color);
    attributes(marker,{color,fill:'currentColor',stroke:'currentColor',opacity:ast ? 1 : .48});
  }
  if (!ast) for (const path of adaptor.tags(svg,'path')) {
    let marked = false;
    for (let node = adaptor.parent(path);node && node !== svg;node = adaptor.parent(node)) {
      if (/^fc-[ds][0-3]$/.test(adaptor.getAttribute(node,'id') || '')) { marked = true; break; }
    }
    if (!marked) attributes(path,{opacity:.44});
  }
}
export async function renderSvg({state,ast}: RenderInput) {
  Share.params(state); // Public renderer accepts only the same finite state space as URLs.
  ast = Expression.validateAst(ast,state.t.slice(0,4));
  if (!wasmReady) throw new Error('OG renderer has not been initialized');
  await wasmReady;
  const engine = await engineFor(state.font,state.numerals);
  const task = engine.queue.then(async () => {
    const tex = Expression.frameTex(ast,state.t.slice(0,4),Number(state.t.slice(4)),{...engine.profile,division:state.division});
    const svg = await convert(engine,tex);
    const viewBox = box(svg), ink = inkBounds(svg);
    const equal = ast ? byId(svg,'fc-eq') : null;
    const axisY = equal ? inkBounds(svg,equal).centerY : engine.typography.equalCenterY;
    const bounds: Bounds = {x:Math.min(viewBox.x,ink.x),y:Math.min(viewBox.y,ink.y),w:0,h:0};
    bounds.w = Math.max(viewBox.x + viewBox.w,ink.x + ink.w) - bounds.x;
    bounds.h = Math.max(viewBox.y + viewBox.h,ink.y + ink.h) - bounds.y;
    const fit = Display.fitFrame(bounds,axisY,1100,370);
    fit.x += 50; fit.y += 130; fit.axis += 130;
    paint(svg,ast);
    const slots = Array.from({length:6},(_,i) => {
      const id = `fc-${i < 4 ? 'd'+i : 's'+(i-4)}`;
      return adaptor.tags(byId(svg,id),'path').map(path => adaptor.getAttribute(path,'d'));
    });
    // Keeping the MathJax root group retains its y inversion and nested scales.
    const content = `<g id="equation" color="${COLORS.symbols}" fill="currentColor" stroke="currentColor" stroke-width="0" transform="matrix(${fit.scale} 0 0 ${fit.scale} ${fit.x} ${fit.y})">${adaptor.innerHTML(svg)}</g>`;
    return {svg:canvas(content),tex,viewBox,ink,axisY,fit,typography:engine.typography,slots};
  });
  engine.queue = task.catch(() => {});
  return task;
}
export function pngFromSvg(svg: string): Uint8Array<ArrayBuffer> {
  const raster = new Resvg(svg,rasterOptions);
  let rendered;
  try { rendered = raster.render(); return rendered.asPng().slice(); }
  finally { rendered?.free(); raster.free(); }
}
export async function renderOg(input: RenderInput) { return pngFromSvg((await renderSvg(input)).svg); }
export function renderDefaultOg() { return pngFromSvg(canvas('',DEFAULT_BRAND)); }
