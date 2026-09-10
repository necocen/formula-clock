import wasm from '@resvg/resvg-wasm/index_bg.wasm';
import {createHandler} from './handler.mjs';
import {initRenderer,renderOg} from './render.mjs';

export default createHandler({revision:OG_RENDER_REVISION,renderOg:async input => {
  await initRenderer(wasm);
  return renderOg(input);
}});
