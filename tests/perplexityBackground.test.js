import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { expect, it, vi } from 'vitest';
import { publicFile } from '../scripts/publicFiles.js';

const helper = readFileSync(new URL('../chrome-extension/perplexityBackground.js', import.meta.url), 'utf8');
const scraper = readFileSync(new URL('../chrome-extension/privateBrowserAdapters.js', import.meta.url), 'utf8');
const href = 'https://www.perplexity.ai/search/test';
function fixture(install = true) {
  const { document } = parseHTML('<html><body><div id="thread"></div><div id="other"></div></body></html>');
  const root = document.querySelector('#thread');
  const native = [];
  class NativeObserver {
    constructor(callback, options = {}) { this.callback = callback; this.root = options.root || null; native.push(this); }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const context = { document, window: document.defaultView, URL, IntersectionObserver: NativeObserver,
    innerWidth: 800, innerHeight: 600, performance: { now: () => Date.now() }, queueMicrotask,
    setTimeout: (...args) => setTimeout(...args), clearTimeout: id => clearTimeout(id),
    Date: class extends Date { static now() { return Date.now(); } } };
  vm.createContext(context);
  if (install) vm.runInContext(helper, context);
  vm.runInContext(scraper, context);
  const rows = Array.from({ length: 22 }, (_, index) => {
    const row = document.createElement('div');
    row.className = 'w-full';
    row.getBoundingClientRect = () => ({ top: index * 500, bottom: index * 500 + 400, left: 0, right: 800, width: 800, height: 400 });
    root.append(row);
    const render = visible => { row.innerHTML = `<div class="w-full flex flex-col">${visible ? index % 2
      ? `<div data-workflow-final-text>Answer ${index}</div>`
      : `<div class="group/user-bubble">Question ${index}</div>` : ''}</div>`; };
    // This is Perplexity's virtualizer contract: an intersection callback is
    // the only thing that mounts the row. Timer/scroll/rAF pulses cannot do it.
    const observer = new context.IntersectionObserver(([entry]) => render(entry.isIntersecting), { rootMargin: '2000px 0px' });
    observer.observe(row);
    render(index >= 17);
    return row;
  });
  document.documentElement.scrollTop = 100;
  return { context, document, root, rows, native };
}

it('captures every Perplexity position with native intersection delivery suspended, then restores virtualization', async () => {
  const { context, root, rows, document } = fixture();
  const logs = [];
  const result = await context.AIChatExporterPrivateAdapters.exportConversation(document, href, {
    includeMedia: false, requireBackgroundRendering: true, onProgress: value => logs.push(value),
  });
  expect(result.messages.map(m => m.text)).toEqual(rows.map((_, i) => `${i % 2 ? 'Answer' : 'Question'} ${i}`));
  expect(logs.join(' ')).toContain('Verified 22/22');
  expect(logs.join(' ')).not.toContain('sweep');
  expect(root.hasAttribute('data-ai-exporter-perplexity-root')).toBe(false);
  expect(rows.at(-1).querySelector('[data-workflow-final-text]')).toBeNull();
  expect(document.documentElement.scrollTop).toBe(100);
});

it('pins only selected message observers, not telemetry or another thread, and stops on cancellation', () => {
  const { context, root, rows, document, native } = fixture();
  const unrelated = vi.fn();
  const observer = new context.IntersectionObserver(unrelated, { rootMargin: '0px' });
  observer.observe(rows[0]);
  root.setAttribute('data-ai-exporter-perplexity-root', '');
  document.dispatchEvent(new document.defaultView.Event('__aiExporterPerplexityStart'));
  native[21].callback([{ target: rows[21], isIntersecting: false }], native[21]);
  expect(rows[21].querySelector('[data-workflow-final-text]')).not.toBeNull();
  expect(unrelated).not.toHaveBeenCalled();
  document.dispatchEvent(new document.defaultView.Event('__exportCancel'));
  expect(rows[21].querySelector('[data-workflow-final-text]')).toBeNull();
  expect(root.hasAttribute('data-ai-exporter-rendered-rows')).toBe(false);
});

it('tells an already-open Perplexity tab to refresh rather than repeat the broken scroll scan', async () => {
  const { context, document, root } = fixture(false);
  await expect(context.AIChatExporterPrivateAdapters.exportConversation(document, href, { requireBackgroundRendering: true }))
    .rejects.toThrow(/Refresh this Perplexity chat once/);
  expect(root.hasAttribute('data-ai-exporter-perplexity-root')).toBe(false);
});

it('includes the automatic Perplexity helper in public builds', () => {
  const manifest = readFileSync(new URL('../chrome-extension/manifest.json', import.meta.url));
  expect(JSON.parse(publicFile('chrome-extension/manifest.json', manifest)).content_scripts[0]).toMatchObject({ world: 'MAIN', run_at: 'document_start', js: ['perplexityBackground.js'] });
  expect(publicFile('chrome-extension/perplexityBackground.js', helper)).toBe(helper);
});
