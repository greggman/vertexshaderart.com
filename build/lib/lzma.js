import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import vm from 'node:vm';

const dirname = path.dirname(url.fileURLToPath(import.meta.url));
const workerPath = path.join(dirname, '..', '..', 'src', 'lzma_worker.js');

// lzma_worker.js is written to run inside a WebWorker. It hands results back
// through postMessage instead of returning them, so run it in a vm with a
// postMessage that captures the result.
//
//   action 1 = compress result, 2 = decompress result, 3 = progress
const ACTION_COMPRESS = 1;
const ACTION_DECOMPRESS = 2;

function makeLZMA() {
  const pending = new Map();
  const context = {
    console,
    setTimeout,
    clearTimeout,
    postMessage(msg) {
      if (msg.action === ACTION_COMPRESS || msg.action === ACTION_DECOMPRESS) {
        const resolve = pending.get(msg.callback_num);
        pending.delete(msg.callback_num);
        resolve?.(msg.result);
      }
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(workerPath, 'utf8'), context);

  let nextCallbackNum = 0;
  function call(fn, ...args) {
    return new Promise(resolve => {
      const callbackNum = nextCallbackNum++;
      pending.set(callbackNum, resolve);
      fn(...args, callbackNum);
    });
  }

  return {
    compress: (str, mode = 1) => call(context.LZMA.compress, str, mode),
    decompress: bytes => call(context.LZMA.decompress, bytes),
  };
}

let lzma;

/**
 * Decodes the `#s=` parameter of a vertexshaderart URL into an art object,
 * matching what src/js/main.js does in the browser.
 * @param {string} s base64 of lzma compressed JSON
 * @returns {Promise<{settings: object}>}
 */
export async function decodeSettingsParam(s) {
  lzma = lzma || makeLZMA();
  const buf = Buffer.from(s, 'base64');
  // LZMA-JS wants signed bytes
  const bytes = Array.from(buf, b => (b > 127 ? b - 256 : b));
  const text = await lzma.decompress(bytes);
  if (typeof text !== 'string') {
    throw new Error('could not lzma decompress the s= parameter');
  }
  return JSON.parse(text);
}

/**
 * Encodes an art object the way the site does (mostly useful for round trip tests)
 * @param {object} art
 * @returns {Promise<string>} base64 of lzma compressed JSON
 */
export async function encodeSettingsParam(art) {
  lzma = lzma || makeLZMA();
  const bytes = await lzma.compress(JSON.stringify(art), 1);
  return Buffer.from(Uint8Array.from(bytes, b => b & 0xff)).toString('base64');
}
