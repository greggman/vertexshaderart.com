import fs from 'node:fs/promises';
import puppeteer from 'puppeteer';
import {startServer} from './server.js';

/**
 * Renders an art in a real browser and grabs a thumbnail.
 *
 * The site gates rendering (and audio) behind a click on the `#start` overlay,
 * so we click it, let the thing run for `seconds` (music playing so sound
 * reactive shaders have data in their history textures), then call the site's
 * own takeScreenshot which renders at 2x into the 600x336 thumbnail canvas.
 *
 * @param {object} options
 * @param {string} options.root repo root to serve
 * @param {string} options.artId id of the art (must already have art/<id>/art.json)
 * @param {string} options.outPath where to write the jpg
 * @param {number} [options.seconds] how long to let it run before the shot
 * @param {number} [options.quality] jpeg quality 0..1
 * @param {boolean} [options.headless]
 * @param {boolean} [options.verbose] forward the page's console to ours
 */
export async function screenshotArt({
  root,
  artId,
  outPath,
  seconds = 30,
  quality = 0.8,
  headless = true,
  verbose = false,
}) {
  const server = await startServer(root);
  const browser = await puppeteer.launch({
    headless,
    args: [
      // don't let chrome's autoplay policy get between us and the music
      '--autoplay-policy=no-user-gesture-required',
      // prefer the real gpu through angle, but let chrome fall back to
      // swiftshader rather than fail to make a webgl context at all
      '--use-gl=angle',
      '--enable-unsafe-swiftshader',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({width: 1280, height: 720, deviceScaleFactor: 1});

    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    if (verbose) {
      page.on('console', async e => {
        const args = await Promise.all(e.args().map(a => a.jsonValue().catch(() => a.toString())));
        console.log('  [page]', ...args);
      });
    }

    // The site streams music through `new Audio()` which never lands in the
    // DOM, and feeds an AnalyserNode whose output becomes the `sound` texture
    // sound reactive shaders sample. Tap both so we can report whether the art
    // actually had music, and whether that music produced any data.
    await page.evaluateOnNewDocument(() => {
      const OrigAudio = window.Audio;
      window.__vsaAudioElements = [];
      window.Audio = function(...args) {
        const audio = new OrigAudio(...args);
        window.__vsaAudioElements.push(audio);
        return audio;
      };

      window.__vsaSoundMax = 0;
      const getByteFrequencyData = AnalyserNode.prototype.getByteFrequencyData;
      AnalyserNode.prototype.getByteFrequencyData = function(array) {
        getByteFrequencyData.call(this, array);
        let max = 0;
        for (let i = 0; i < array.length; ++i) {
          max = Math.max(max, array[i]);
        }
        window.__vsaSoundMax = Math.max(window.__vsaSoundMax, max);
      };
    });

    const url = `http://127.0.0.1:${server.port}/src/?art=${artId}`;
    await page.goto(url, {waitUntil: 'networkidle2'});

    // main.js shows this overlay once the art's settings are loaded
    await page.waitForSelector('#start', {visible: true, timeout: 30000});
    await page.click('#start');

    // main.js shows #nogl when it can't get a webgl context
    const noGL = await page.evaluate(() => document.querySelector('#nogl')?.style.display === '');
    if (noGL) {
      throw new Error(`the browser could not create a webgl context${pageErrors.length ? `: ${pageErrors.join('\n')}` : ''}`);
    }
    if (verbose) {
      const renderer = await page.evaluate(() => {
        const gl = document.createElement('canvas').getContext('webgl');
        const ext = gl?.getExtension('WEBGL_debug_renderer_info');
        return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
      });
      console.log(`  renderer: ${renderer}`);
    }

    console.log(`  running for ${seconds}s...`);
    await new Promise(resolve => setTimeout(resolve, seconds * 1000));

    const soundState = await page.evaluate(() => {
      const audio = (window.__vsaAudioElements || []).findLast(a => a.currentSrc);
      return {
        max: window.__vsaSoundMax,
        ...(audio && {src: audio.currentSrc, time: audio.currentTime, paused: audio.paused}),
      };
    });
    if (!soundState.src) {
      console.log('  music: none');
    } else {
      console.log(`  music: ${soundState.paused ? 'PAUSED' : 'playing'} @${soundState.time.toFixed(1)}s, loudest sample ${soundState.max}/255`);
      if (verbose) {
        console.log(`  track: ${decodeURIComponent(soundState.src)}`);
      }
      if (!soundState.max) {
        console.warn('  WARNING: the analyser never saw any audio, sound reactive shaders will be flat');
      }
    }

    const dataURL = await page.evaluate((type, q) => new Promise((resolve, reject) => {
      // main.js is an AMD module and doesn't put itself on window. requirejs
      // caches modules so asking for it again gives us the running instance.
      requirejs(['main'], main => {
        try {
          resolve(main.takeScreenshot(type, q).dataURL);
        } catch (e) {
          reject(e.message);
        }
      }, e => reject(e.message));
    }), 'image/jpeg', quality);

    const base64 = dataURL.substring(dataURL.indexOf(',') + 1);
    await fs.writeFile(outPath, base64, 'base64');
    return {seconds, music: !!soundState.src, soundMax: soundState.max};
  } finally {
    await browser.close();
    await server.close();
  }
}
