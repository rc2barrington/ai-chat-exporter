import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { expect, it, vi } from 'vitest';

const helper = readFileSync(new URL('../chrome-extension/perplexityBackground.js', import.meta.url), 'utf8');
const scraper = readFileSync(new URL('../chrome-extension/extraBrowserAdapters.js', import.meta.url), 'utf8');
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
  const result = await context.AIChatExporterExtraAdapters.exportConversation(document, href, {
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
  await expect(context.AIChatExporterExtraAdapters.exportConversation(document, href, { requireBackgroundRendering: true }))
    .rejects.toThrow(/Refresh this Perplexity chat once/);
  expect(root.hasAttribute('data-ai-exporter-perplexity-root')).toBe(false);
});

// A long thread as Perplexity loads it: the newest turns first, and the rest
// only when its thread view's pagination control is asked for them. The
// control and the entries are props of a React component above every message.
function longThread({ older = 10, newer = 22, failLoad = false } = {}) {
  const { document } = parseHTML('<html><body><div id="thread"></div></body></html>');
  const root = document.querySelector('#thread');
  const native = [];
  class NativeObserver {
    constructor(callback, options = {}) { this.callback = callback; this.root = options.root || null; native.push(this); }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const timers = { setTimeout: (...args) => setTimeout(...args), clearTimeout: id => clearTimeout(id) };
  const context = { document, window: document.defaultView, URL, IntersectionObserver: NativeObserver,
    innerWidth: 800, innerHeight: 600, performance: { now: () => Date.now() }, queueMicrotask, ...timers,
    Date: class extends Date { static now() { return Date.now(); } } };
  vm.createContext(context);
  vm.runInContext(helper, context);
  vm.runInContext(scraper, context);
  const view = { entries: [], pagination: { position: 'start', hasMore: true, isLoading: false, hasError: false, loadMore: null } };
  const leaf = { memoizedProps: {}, return: { memoizedProps: { className: 'thread' }, return: { memoizedProps: view, return: null } } };
  const makeRow = index => {
    const row = document.createElement('div');
    row.className = 'w-full';
    row.getBoundingClientRect = () => ({ top: index * 500, bottom: index * 500 + 400, left: 0, right: 800, width: 800, height: 400 });
    const render = visible => {
      row.innerHTML = `<div class="w-full flex flex-col">${visible ? index % 2
        ? `<div data-workflow-final-text>Answer ${index}</div>`
        : `<div class="group/user-bubble">Question ${index}</div>` : ''}</div>`;
      const node = row.querySelector('[data-workflow-final-text], [class~="group/user-bubble"]');
      if (node) node.__reactFiber$test = leaf;
    };
    new context.IntersectionObserver(([entry]) => render(entry.isIntersecting), { rootMargin: '2000px 0px' }).observe(row);
    render(index >= older + newer - 5);
    return row;
  };
  for (let index = older; index < older + newer; index++) root.append(makeRow(index));
  view.entries = Array.from({ length: newer / 2 }, () => ({}));
  view.pagination.loadMore = vi.fn(() => {
    view.pagination.isLoading = true;
    setTimeout(() => {
      view.pagination.isLoading = false;
      if (failLoad) { view.pagination.hasError = true; return; }
      root.prepend(...Array.from({ length: older }, (_, index) => makeRow(index)));
      view.entries = Array.from({ length: (older + newer) / 2 }, () => ({}));
      view.pagination.hasMore = false;
    }, 300);
  });
  return { context, document, root, view };
}

it('loads the older turns of a long Perplexity thread before reading it', async () => {
  const { context, document, view } = longThread();
  const logs = [];
  const result = await context.AIChatExporterExtraAdapters.exportConversation(document, href, {
    includeMedia: false, requireBackgroundRendering: true, onProgress: value => logs.push(value),
  });
  expect(view.pagination.loadMore).toHaveBeenCalledTimes(1);
  expect(result.messages.map(m => m.text)).toEqual(Array.from({ length: 32 }, (_, i) => `${i % 2 ? 'Answer' : 'Question'} ${i}`));
  expect(logs.join(' ')).toContain('Loading the turns before the 11 loaded so far');
  expect(result.history.basis).toBe('Captured all 32 Perplexity message positions exposed by the conversation page, after loading 1 older part of the thread.');
  expect(document.documentElement.hasAttribute('data-ai-exporter-perplexity-pages')).toBe(false);
});

it('refuses a Perplexity export when the older turns will not load', async () => {
  const { context, document } = longThread({ failLoad: true });
  await expect(context.AIChatExporterExtraAdapters.exportConversation(document, href, { includeMedia: false, requireBackgroundRendering: true }))
    .rejects.toThrow('Perplexity could not load the older turns of this thread. No partial conversation was saved.');
});

it('says so when Perplexity\'s paging could not be checked', async () => {
  const { context, document } = fixture();
  const result = await context.AIChatExporterExtraAdapters.exportConversation(document, href, { includeMedia: false, requireBackgroundRendering: true });
  expect(result.history.basis).toContain('Whether Perplexity held older turns could not be checked.');
});

it('registers the automatic Perplexity helper', () => {
  const manifest = readFileSync(new URL('../chrome-extension/manifest.json', import.meta.url));
  expect(JSON.parse(manifest).content_scripts[0]).toMatchObject({ world: 'MAIN', run_at: 'document_start', js: ['perplexityBackground.js'] });
  expect(helper).toBe(helper);
});
