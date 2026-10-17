import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { expect, it, vi } from 'vitest';

const helper = readFileSync(new URL('../chrome-extension/museBackground.js', import.meta.url), 'utf8');
const scraper = readFileSync(new URL('../chrome-extension/extraBrowserAdapters.js', import.meta.url), 'utf8');
const href = 'https://muse.ai/thread/test';
const ROW = 100, VIEW = 300;

// A Muse chat in a background tab. Native intersection callbacks never run,
// so only the helper can render rows or load older history. Older pages take
// longer than the exporter's old one-second pause, as they do on the real site.
function fixture({ install = true, total = 12, loaded = 4, page = 4, delay = 3000 } = {}) {
  const { document, window } = parseHTML('<html><body><div id="feed"><div aria-label="Chat messages"></div><div id="sentinel"></div></div></body></html>');
  const feed = document.querySelector('#feed');
  const list = feed.querySelector('[aria-label="Chat messages"]');
  const sentinel = feed.querySelector('#sentinel');
  const native = [];
  class NativeObserver {
    constructor(callback, options = {}) { this.callback = callback; this.root = options.root || null; native.push(this); }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const context = { document, window, Element: window.Element, URL, IntersectionObserver: NativeObserver,
    innerWidth: 800, innerHeight: 600, performance: { now: () => Date.now() }, queueMicrotask,
    setTimeout: (...args) => setTimeout(...args), clearTimeout: id => clearTimeout(id),
    Date: class extends Date { static now() { return Date.now(); } } };
  vm.createContext(context);
  if (install) vm.runInContext(helper, context);
  vm.runInContext(scraper, context);

  // Column-reverse feed: the sentinel sits above the oldest loaded message.
  let position = 0;
  const height = () => 1 + list.children.length * ROW;
  const viewTop = () => height() - VIEW + position;
  const rect = (top, bottom) => ({ top, bottom, left: 0, right: 800, width: 800, height: bottom - top });
  Object.defineProperty(feed, 'scrollHeight', { get: height });
  Object.defineProperty(feed, 'clientHeight', { get: () => VIEW });
  Object.defineProperty(feed, 'scrollTop', { get: () => position, set: value => { position = Math.max(VIEW - height(), Math.min(0, value)); } });
  feed.getBoundingClientRect = () => rect(0, VIEW);
  list.getBoundingClientRect = () => rect(1 - viewTop(), height() - viewTop());
  sentinel.getBoundingClientRect = () => rect(-viewTop(), 1 - viewTop());
  window.getComputedStyle = node => ({ overflowY: node === feed ? 'auto' : 'visible' });

  const render = (row, visible) => {
    const index = Number(row.getAttribute('data-message-id').slice(1));
    row.innerHTML = visible ? `<p>Message ${index}</p>`
      : `<div style="height:${ROW}px"></div><span data-message-accessibility-surrogate data-message-search-surrogate>${index % 2 ? 'Assistant' : 'User'} message: Message ${index}</span>`;
  };
  const rows = new context.IntersectionObserver(entries => entries.forEach(entry => render(entry.target, entry.isIntersecting)), { rootMargin: '1000px' });
  const telemetry = vi.fn();
  const impressions = new context.IntersectionObserver(telemetry, { threshold: 0.5 });
  const add = indexes => {
    const nodes = indexes.map(index => {
      const row = document.createElement('div');
      row.setAttribute('data-message-item', '');
      row.setAttribute('data-message-id', `m${index}`);
      row.setAttribute('data-message-role', index % 2 ? 'assistant' : 'user');
      row.getBoundingClientRect = () => { const at = [...list.children].indexOf(row); return rect(1 + at * ROW - viewTop(), 1 + (at + 1) * ROW - viewTop()); };
      // Rows whose height Muse has cached start as placeholders.
      render(row, false);
      return row;
    });
    list.prepend(...nodes);
    for (const row of nodes) { rows.observe(row); impressions.observe(row); }
  };
  add(Array.from({ length: loaded }, (_, i) => total - loaded + i));

  // Muse observes the top sentinel only while older history exists.
  let first = total - loaded, inFlight = false, history = null;
  const watchHistory = () => {
    history = new context.IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting || inFlight) return;
      inFlight = true;
      setTimeout(() => {
        const next = Math.max(0, first - page);
        add(Array.from({ length: first - next }, (_, i) => next + i));
        first = next;
        inFlight = false;
        if (!first) history.disconnect();
      }, delay);
    }, { root: feed, threshold: 0 });
    history.observe(sentinel);
  };
  watchHistory();
  return { context, document, list, feed, native, telemetry, rowObserver: () => native[0] };
}

it('exports every Muse message with native intersection delivery suspended, waiting out slow history pages', async () => {
  vi.useFakeTimers();
  try {
    // Long enough that the oldest rows end up more than 1000px from the view.
    const { context, document, list, feed, telemetry } = fixture({ total: 30 });
    const logs = [];
    const pending = context.AIChatExporterExtraAdapters.exportConversation(document, href, {
      includeMedia: false, requireBackgroundRendering: true, onProgress: value => logs.push(value),
    });
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(result.messages.map(m => m.text)).toEqual(Array.from({ length: 30 }, (_, i) => `Message ${i}`));
    expect(logs.join(' ')).toContain('Loading older Muse messages');
    expect(telemetry).not.toHaveBeenCalled();
    // Virtualization resumes: the rows far above the restored position unload.
    expect(document.documentElement.hasAttribute('data-ai-exporter-muse-rendered-rows')).toBe(false);
    expect(document.documentElement.hasAttribute('data-ai-exporter-muse-history')).toBe(false);
    expect(feed.scrollTop).toBe(0);
    expect(list.firstElementChild.querySelector('[data-message-accessibility-surrogate]')).not.toBeNull();
    expect(list.lastElementChild.querySelector('[data-message-accessibility-surrogate]')).toBeNull();
  } finally { vi.useRealTimers(); }
});

it('reports which Muse history is still unloaded and pins only message rows', () => {
  const { context, document, list, feed, telemetry, rowObserver } = fixture();
  const below = document.createElement('div');
  feed.prepend(below);
  below.getBoundingClientRect = () => ({ top: list.getBoundingClientRect().bottom, bottom: list.getBoundingClientRect().bottom + 1, left: 0, right: 800 });
  const newer = new context.IntersectionObserver(() => {}, { root: feed, threshold: 0 });
  newer.observe(below);
  document.dispatchEvent(new document.defaultView.Event('__aiExporterMuseStart'));
  expect(document.documentElement.getAttribute('data-ai-exporter-muse-history')).toBe('older newer');
  expect(document.documentElement.getAttribute('data-ai-exporter-muse-rendered-rows')).toBe('4');
  expect(list.querySelectorAll('[data-message-accessibility-surrogate]')).toHaveLength(0);
  // A late native "not intersecting" report does not unload a pinned row.
  rowObserver().callback([{ target: list.lastElementChild, isIntersecting: false }], rowObserver());
  expect(list.lastElementChild.querySelector('[data-message-accessibility-surrogate]')).toBeNull();
  expect(telemetry).not.toHaveBeenCalled();
  newer.disconnect();
  return Promise.resolve().then(() => {
    expect(document.documentElement.getAttribute('data-ai-exporter-muse-history')).toBe('older');
    document.dispatchEvent(new document.defaultView.Event('__exportCancel'));
    expect(document.documentElement.hasAttribute('data-ai-exporter-muse-history')).toBe(false);
    expect(document.documentElement.hasAttribute('data-ai-exporter-muse-rendered-rows')).toBe(false);
  });
});

it('loads lazy Muse images inside messages but leaves other lazy content alone', () => {
  const { context, document, list } = fixture();
  // A row the fixture does not re-render, so the skeleton stays in place.
  const row = document.createElement('div');
  row.setAttribute('data-message-item', '');
  const skeleton = document.createElement('div');
  row.append(skeleton);
  list.append(row);
  const outside = document.createElement('div');
  document.body.append(outside);
  for (const node of [skeleton, outside]) node.getBoundingClientRect = () => ({ top: 5000, bottom: 5220, left: 0, right: 220 });
  const loaded = [];
  const media = new context.IntersectionObserver(entries => entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    loaded.push(entry.target);
    media.unobserve(entry.target);
  }), { rootMargin: '200px' });
  media.observe(skeleton);
  media.observe(outside);
  document.dispatchEvent(new document.defaultView.Event('__aiExporterMuseStart'));
  expect(loaded).toEqual([skeleton]);
  document.dispatchEvent(new document.defaultView.Event('__aiExporterMuseStop'));
});

it('tells an already-open Muse tab to refresh rather than export placeholders', async () => {
  const { context, document } = fixture({ install: false });
  await expect(context.AIChatExporterExtraAdapters.exportConversation(document, href, { requireBackgroundRendering: true }))
    .rejects.toThrow(/Refresh this Muse chat once/);
});

it('refuses a Muse export when older history stops loading', async () => {
  vi.useFakeTimers();
  try {
    const { context, document } = fixture({ delay: 10 * 60 * 1000 });
    const pending = context.AIChatExporterExtraAdapters.exportConversation(document, href, { includeMedia: false, requireBackgroundRendering: true });
    const assertion = expect(pending).rejects.toThrow(/stopped loading older messages/);
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    await assertion;
  } finally { vi.useRealTimers(); }
});

it('registers the automatic Muse helper', () => {
  const manifest = JSON.parse(readFileSync(new URL('../chrome-extension/manifest.json', import.meta.url)));
  expect(manifest.content_scripts).toContainEqual({ matches: ['https://muse.ai/*', 'https://www.muse.ai/*'], js: ['museBackground.js'], run_at: 'document_start', world: 'MAIN' });
});

// A Muse tab loaded while hidden stays on "Loading chat" until it is shown.
// Muse's own router refresh finishes the load without navigating.
it('refreshes a Muse tab that is stuck loading its chat, then exports it', async () => {
  vi.useFakeTimers();
  try {
    const { context, document, list } = fixture();
    const rows = [...list.children];
    rows.forEach(row => row.remove());
    const refresh = vi.fn(() => setTimeout(() => list.append(...rows), 1500));
    context.next = { router: { refresh } };
    const logs = [];
    const pending = context.AIChatExporterExtraAdapters.exportConversation(document, href, {
      includeMedia: false, requireBackgroundRendering: true, onProgress: value => logs.push(value),
    });
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(logs[0]).toMatch(/Waiting for Muse to finish loading/);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(result.messages).toHaveLength(12);
  } finally { vi.useRealTimers(); }
});
