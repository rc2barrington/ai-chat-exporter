// MAIN world, document_start. Registers before Muse creates its observer.
//
// Muse renders a message's real content only after one shared
// IntersectionObserver (rootMargin "1000px") reports that message on screen.
// Until then the row is an empty fixed-height box plus a hidden text copy.
// Chrome does not run intersection callbacks in background tabs, so a
// background export would find most messages stuck as placeholders.
//
// History has the same dependency: an empty sentinel above the chat loads the
// next page of older messages when its observer fires, and one below loads
// newer messages after a jump to the top. In a background tab that never
// happens, so history silently stops loading.
//
// Images inside a message are lazier still: each one waits for its own
// observer (rootMargin "200px") before replacing a skeleton with the picture.
//
// While an export is running, this reports every observed message row and
// every such media loader inside a row as intersecting, so all of them
// render, and reports the history sentinels from
// their real position on every scroll and whenever Muse observes one, so pages
// keep loading exactly as they would on screen. Analytics observers are left
// untouched. Afterwards it replays the real geometry so Muse can unload
// far-off rows.
//
// Muse keeps a sentinel observed only while more history exists on its side,
// so data-ai-exporter-muse-history tells the exporter whether older or newer
// messages remain ("older", "newer", both, or "complete"). A pause in loading
// is not mistaken for the start or end of the chat.
//
// A Muse tab that loads while hidden can stay on "Loading chat" until it is
// shown. Muse's own router refresh finishes that load without navigating, so
// the exporter can ask for one. No conversation data is read here.
(() => {
  if (globalThis.__aiExporterMuseObserverBridge || typeof IntersectionObserver !== 'function') return;
  globalThis.__aiExporterMuseObserverBridge = true;
  const NativeObserver = IntersectionObserver;
  // Message rows use 1000px. Images, video and previews inside a message
  // load once a 200px observer sees them. Impression analytics use neither.
  const MARGINS = { '1000px': 1000, '200px': 200 };
  const ROWS = 'data-ai-exporter-muse-rendered-rows';
  const HISTORY = 'data-ai-exporter-muse-history';
  const records = new Set();
  let active = false, publishQueued = false;
  const isRow = (record, target) => record.margin === '1000px' && target.matches?.('[data-message-item]');
  const isPinned = (record, target) => isRow(record, target)
    || (record.margin === '200px' && !!target.closest?.('[data-message-item]'));
  const chatList = record => record.observer.root instanceof Element
    ? record.observer.root.querySelector('[aria-label="Chat messages"]') : null;
  // History sentinels: an observer rooted at the chat scroll container, with no
  // margin, watching a marker that is not itself a message.
  const isSentinel = (record, target) => !record.margin && !!chatList(record) && !target.matches?.('[data-message-item]');
  const entryFor = (record, target, visible) => {
    const rect = target.getBoundingClientRect();
    const bounds = record.observer.root?.getBoundingClientRect() || {
      top: 0, left: 0, right: innerWidth, bottom: innerHeight, width: innerWidth, height: innerHeight,
    };
    return { target, time: performance.now(), boundingClientRect: rect, rootBounds: bounds,
      intersectionRect: visible ? rect : { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 },
      isIntersecting: visible, intersectionRatio: visible ? 1 : 0 };
  };
  const measured = (record, target, margin = 0) => {
    const probe = entryFor(record, target, false);
    const r = probe.boundingClientRect, b = probe.rootBounds;
    return entryFor(record, target, r.bottom >= b.top - margin && r.top <= b.bottom + margin
      && r.right >= b.left - margin && r.left <= b.right + margin);
  };
  const reportSentinels = only => {
    if (!active) return;
    for (const record of only ? [only] : records) {
      const entries = [...record.targets].filter(target => isSentinel(record, target)).map(target => measured(record, target));
      if (entries.length) record.callback(entries, record.observer);
    }
  };
  const pin = record => {
    const entries = [...record.targets].filter(target => isPinned(record, target)).map(target => entryFor(record, target, true));
    if (entries.length) record.callback(entries, record.observer);
    return entries.filter(entry => isRow(record, entry.target)).length;
  };
  const publish = () => {
    publishQueued = false;
    if (!active) return;
    const pending = new Set();
    for (const record of records) {
      for (const target of record.targets) {
        if (!isSentinel(record, target)) continue;
        const rect = target.getBoundingClientRect(), list = chatList(record).getBoundingClientRect();
        if (rect.top < list.top) pending.add('older');
        else if (rect.bottom > list.bottom) pending.add('newer');
      }
    }
    document.documentElement.setAttribute(HISTORY, [...pending].join(' ') || 'complete');
  };
  // React swaps a sentinel's observer by disconnecting the old one and
  // observing with a new one in the same task. Publish once both are done.
  const queuePublish = () => {
    if (!active || publishQueued) return;
    publishQueued = true;
    queueMicrotask(publish);
  };
  globalThis.IntersectionObserver = class extends NativeObserver {
    constructor(callback, options) {
      const record = { callback, targets: new Set(), margin: options?.rootMargin, observer: null };
      super((entries, observer) => callback(entries.map(entry => active && isPinned(record, entry.target)
        ? entryFor(record, entry.target, true) : entry), observer), options);
      record.observer = this;
      this.__exportMuseRecord = record;
    }
    observe(target) {
      super.observe(target);
      const record = this.__exportMuseRecord;
      record.targets.add(target);
      records.add(record);
      // A native observer reports a new target's state straight away. Rows
      // mounted during the export render immediately, and a new sentinel
      // learns where it is.
      if (active) queueMicrotask(() => { pin(record); reportSentinels(record); queuePublish(); });
    }
    unobserve(target) {
      super.unobserve(target);
      this.__exportMuseRecord.targets.delete(target);
      if (!this.__exportMuseRecord.targets.size) records.delete(this.__exportMuseRecord);
      queuePublish();
    }
    disconnect() {
      super.disconnect();
      this.__exportMuseRecord.targets.clear();
      records.delete(this.__exportMuseRecord);
      queuePublish();
    }
  };
  const stop = () => {
    if (!active) return;
    active = false;
    document.documentElement.removeAttribute(ROWS);
    document.documentElement.removeAttribute(HISTORY);
    for (const record of records) {
      const entries = [...record.targets].filter(target => isPinned(record, target))
        .map(target => measured(record, target, MARGINS[record.margin]));
      if (entries.length) record.callback(entries, record.observer);
    }
  };
  document.addEventListener('__aiExporterMuseStart', () => {
    stop();
    active = true;
    let count = 0;
    for (const record of records) count += pin(record);
    document.documentElement.setAttribute(ROWS, String(count));
    reportSentinels();
    publish();
  });
  // Scroll events do not bubble, so listen in the capture phase.
  document.addEventListener('scroll', () => reportSentinels(), true);
  document.addEventListener('__aiExporterMuseStop', stop);
  document.addEventListener('__aiExporterMuseRefresh', () => { try { globalThis.next?.router?.refresh?.(); } catch { /* The wait reports a chat that never loads. */ } });
  document.addEventListener('__exportCancel', stop);
  window.addEventListener('pagehide', stop);
})();
