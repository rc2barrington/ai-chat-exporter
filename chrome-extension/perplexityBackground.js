// Both editions, MAIN world, document_start. Register before Perplexity
// creates its observers: native intersection callbacks stop in hidden tabs.
// No conversation data is read here. Only selected message rows are pinned.
(() => {
  if (globalThis.__aiExporterPerplexityObserverBridge || typeof IntersectionObserver !== 'function') return;
  globalThis.__aiExporterPerplexityObserverBridge = true;
  const NativeObserver = IntersectionObserver;
  const records = new Set();
  let root = null;
  const isRow = (record, target) => root && target.parentElement === root
    && target.classList.contains('w-full') && record.margin === '2000px 0px';
  const entryFor = (record, target, visible) => {
    const rect = target.getBoundingClientRect();
    const bounds = record.observer.root?.getBoundingClientRect() || {
      top: 0, left: 0, right: innerWidth, bottom: innerHeight, width: innerWidth, height: innerHeight,
    };
    return { target, time: performance.now(), boundingClientRect: rect, rootBounds: bounds,
      intersectionRect: visible ? rect : { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 },
      isIntersecting: visible, intersectionRatio: visible ? 1 : 0 };
  };
  const pin = record => {
    const entries = [...record.targets].filter(target => isRow(record, target)).map(target => entryFor(record, target, true));
    if (entries.length) record.callback(entries, record.observer);
    return entries.length;
  };
  globalThis.IntersectionObserver = class extends NativeObserver {
    constructor(callback, options) {
      const record = { callback, targets: new Set(), margin: options?.rootMargin, observer: null };
      super((entries, observer) => callback(entries.map(entry => isRow(record, entry.target)
        ? entryFor(record, entry.target, true) : entry), observer), options);
      record.observer = this;
      this.__exportRecord = record;
    }
    observe(target) {
      super.observe(target);
      this.__exportRecord.targets.add(target);
      records.add(this.__exportRecord);
      if (root) queueMicrotask(() => pin(this.__exportRecord));
    }
    unobserve(target) {
      super.unobserve(target);
      this.__exportRecord.targets.delete(target);
      if (!this.__exportRecord.targets.size) records.delete(this.__exportRecord);
    }
    disconnect() {
      super.disconnect();
      this.__exportRecord.targets.clear();
      records.delete(this.__exportRecord);
    }
  };
  const stop = () => {
    if (!root) return;
    const previous = root;
    root = null;
    previous.removeAttribute('data-ai-exporter-rendered-rows');
    // Resume the actual viewport, including the virtualizer's 2000px overscan.
    for (const record of records) {
      const entries = [...record.targets].filter(target => target.parentElement === previous && record.margin === '2000px 0px')
        .map(target => {
          const entry = entryFor(record, target, false);
          const r = entry.boundingClientRect, b = entry.rootBounds;
          return entryFor(record, target, r.bottom >= b.top - 2000 && r.top <= b.bottom + 2000 && r.right >= b.left && r.left <= b.right);
        });
      if (entries.length) record.callback(entries, record.observer);
    }
  };
  document.addEventListener('__aiExporterPerplexityStart', () => {
    stop();
    root = document.querySelector('[data-ai-exporter-perplexity-root]');
    if (!root) return;
    let count = 0;
    for (const record of records) count += pin(record);
    root.setAttribute('data-ai-exporter-rendered-rows', String(count));
  });
  document.addEventListener('__aiExporterPerplexityStop', stop);
  document.addEventListener('__exportCancel', stop);
  window.addEventListener('pagehide', stop);
})();
