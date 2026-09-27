import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Buffer } from 'node:buffer';
import { parseHTML } from 'linkedom';
import { describe, it, expect, vi } from 'vitest';
import { publicFile } from '../scripts/publicFiles.js';

const source = readFileSync(new URL('../chrome-extension/privateBrowserAdapters.js', import.meta.url), 'utf8');
const context = { URL, setTimeout: (...args) => setTimeout(...args), clearTimeout: id => clearTimeout(id),
  Date: class extends Date { static now() { return Date.now(); } } };
vm.runInNewContext(source, context);
const adapter = context.AIChatExporterPrivateAdapters;
const muse = 'https://muse.ai/thread/example';
const perplexity = 'https://www.perplexity.ai/search/example';
const doc = html => parseHTML(`<html><body>${html}</body></html>`).document;
const message = (id, role, text) => `<div data-message-item data-message-id="${id}" data-message-role="${role}">${text}</div>`;
const museDoc = text => doc(`<div aria-label="Chat messages">${text}</div>`);
const turn = (q, a) => `<section><div class="group/user-bubble">${q}<button>Copy query</button></div><div data-workflow-final-text>${a}<div data-workflow-text-footer>Copy Share</div></div></section>`;
const virtualRows = (...rows) => `<div class="flex flex-col gap-10">${rows.map(row => `<div class="w-full">${row}</div>`).join('')}</div>`;

describe('Muse and Perplexity browser providers', () => {
  it('accepts only the intended HTTPS conversation hosts and paths', () => {
    expect(adapter.siteName(muse)).toBe('Muse');
    expect(adapter.siteName('https://muse.ai/')).toBe('Muse');
    expect(adapter.siteName(perplexity)).toBe('Perplexity');
    for (const url of ['https://muse.ai.evil.test/thread/x', 'https://evil.test/?muse.ai', 'http://muse.ai/thread/x', 'https://www.perplexity.ai/library']) expect(adapter.siteName(url)).toBe('');
  });
  it('preserves older Muse surrogate messages and repeated turns without duplicating visible content', () => {
    const document = museDoc(message('1','user','<span data-message-accessibility-surrogate>User message: First</span>') + message('2','assistant','<p>Same reply</p><span data-copy-exclude>Copy</span>') + message('3','user','Again') + message('4','assistant','Same reply'));
    expect(adapter.extract(document,muse).messages.map(m=>m.text)).toEqual(['First','Same reply','Again','Same reply']);
  });
  it('pairs Perplexity questions with answers in order and excludes controls', () => {
    const data = adapter.extract(doc(turn('First','<p>Reply <a href="https://example.test/source">Citation</a></p>')+turn('Follow-up','Repeated')),perplexity);
    expect(data.messages.map(m=>m.role)).toEqual(['## You','## Perplexity','## You','## Perplexity']);
    expect(data.messages[1].text).toContain('[Citation](<https://example.test/source>)');
    expect(JSON.stringify(data.messages)).not.toMatch(/Copy|Share/);
  });
  it('does not attach the next answer to an unfinished question', () => {
    expect(()=>adapter.extract(doc('<div class="group/user-bubble">Unfinished</div>'+turn('Other','Answer')),perplexity)).toThrow(/not finished/);
  });
  it('keeps a virtualized Perplexity thread in question-answer order', () => {
    const html = virtualRows(
      '<div class="group/user-bubble">First question</div>',
      '<div data-workflow-final-text>First answer</div>',
      '<div class="group/user-bubble">Second question</div>',
      '<div data-workflow-final-text>Second answer</div>',
    );
    expect(adapter.extract(doc(html), perplexity).messages.map(m => m.text)).toEqual([
      'First question', 'First answer', 'Second question', 'Second answer',
    ]);
    expect(() => adapter.extract(doc(virtualRows('<div class="w-full"></div>', '<div data-workflow-final-text>Answer</div>')), perplexity)).toThrow(/unloaded older turns/);
  });
  it('keeps uploaded images, prefers signed pane URLs and omits sources and other files', () => {
    const base = 'https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/1/2/';
    const html = virtualRows('<div class="group/user-bubble">Question</div>',
      `<div data-workflow-final-text><p>Answer <span class="citation"><a href="https://example.test/article">[1]</a></span></p><span class="citation"><a href="${base}photo.jpg">photo.jpg</a></span><a href="${base}notes.md">notes.md</a></div>`) +
      `<aside><a href="${base}photo.jpg?token=current">photo.jpg</a><a href="${base}photo.jpg?token=current">photo.jpg</a><a href="${base}notes.md">notes.md</a></aside>`;
    const result = adapter.extract(doc(html), perplexity);
    expect(result.messageCount).toBe(2);
    expect(result.remoteQueue).toHaveLength(1);
    expect(result.remoteQueue[0]).toMatchObject({ url: `${base}photo.jpg?token=current`, kind: 'image' });
    expect(result.messages[1].text).toContain('![photo.jpg](media/');
    expect(result.messages[1].text).not.toMatch(/example\.test|\[1\]|media\/perplexity-\d+-notes\.md/);
    expect(result.appendix).toBe('');
    expect(result.failedFetches).toHaveLength(0);
  });
  it('opens a collapsed Perplexity file pane for export and restores it', async () => {
    vi.useFakeTimers();
    const base = 'https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/1/2/';
    const document = doc(virtualRows('<div class="group/user-bubble">Question</div>', `<div data-workflow-final-text>Answer <span class="citation"><a href="${base}a.jpg">a.jpg</a></span></div>`) +
      '<button id="files" aria-expanded="false">Files 3</button><div id="file-links"></div>');
    const files = document.querySelector('#files');
    files.addEventListener('click', () => {
      const open = files.getAttribute('aria-expanded') === 'false';
      files.setAttribute('aria-expanded', String(open));
      document.querySelector('#file-links').innerHTML = open ? `<a href="${base}a.jpg?token=current">a.jpg</a><a href="${base}c.png?token=current">c.png</a><a href="${base}b.pdf">b.pdf</a>` : '';
    });
    Object.defineProperty(document.documentElement, 'scrollHeight', { get: () => 100 });
    Object.defineProperty(document.documentElement, 'clientHeight', { get: () => 100 });
    try {
      const pending = adapter.exportConversation(document, perplexity, { includeMedia: true });
      await vi.runAllTimersAsync();
      const result = await pending;
      expect(result.remoteQueue).toHaveLength(2);
      expect(result.remoteQueue[0]).toMatchObject({ url: `${base}a.jpg?token=current`, kind: 'image' });
      expect(result.appendix).toContain('## Images from this conversation');
      expect(result.appendix).toContain('c.png');
      expect(result.appendix).not.toContain('a.jpg');
      expect(result.appendix).not.toContain('b.pdf');
      expect(files.getAttribute('aria-expanded')).toBe('false');
    } finally { vi.useRealTimers(); }
  });
  it('does not open or export Perplexity Web sources', async () => {
    vi.useFakeTimers();
    const document = doc(virtualRows('<div class="group/user-bubble">Question</div>', '<div data-workflow-final-text>Answer</div>') +
      '<div id="references"><button id="web" aria-expanded="false">Web 5</button><div id="source-scroll"><div id="source-links"></div></div></div>');
    const web = document.querySelector('#web');
    const scroller = document.querySelector('#source-scroll');
    const previousStyle = document.defaultView.getComputedStyle;
    let position = 0;
    const update = () => {
      const first = Math.floor(position / 100);
      document.querySelector('#source-links').innerHTML = web.getAttribute('aria-expanded') === 'true'
        ? [first, first + 1].filter(i => i < 5).map(i => `<a href="https://source${i}.example/story"><span class="line-clamp-2">Source ${i}</span></a>`).join('') : '';
    };
    web.addEventListener('click', () => { web.setAttribute('aria-expanded', String(web.getAttribute('aria-expanded') === 'false')); update(); });
    document.defaultView.getComputedStyle = node => ({ overflowY: node === scroller ? 'auto' : 'visible' });
    Object.defineProperty(document.documentElement, 'scrollHeight', { get: () => 100 });
    Object.defineProperty(document.documentElement, 'clientHeight', { get: () => 100 });
    Object.defineProperty(scroller, 'scrollHeight', { get: () => 500 });
    Object.defineProperty(scroller, 'clientHeight', { get: () => 100 });
    Object.defineProperty(scroller, 'scrollTop', { get: () => position, set: value => { position = Math.max(0, Math.min(400, value)); update(); } });
    try {
      const pending = adapter.exportConversation(document, perplexity, { includeMedia: true });
      await vi.runAllTimersAsync();
      const result = await pending;
      expect(result.appendix).toBe('');
      expect(web.getAttribute('aria-expanded')).toBe('false');
      expect(scroller.scrollTop).toBe(0);
    } finally {
      document.defaultView.getComputedStyle = previousStyle;
      vi.useRealTimers();
    }
  });
  it('keeps Muse image references but not uploaded Markdown files', () => {
    const document=museDoc(message('1','user','<img src="https://muse.ai/image.png"><img src="https://muse.ai/image.png"><a href="/files/notes.md">notes.md</a>'));
    const data=adapter.extract(document,muse);
    expect(data.remoteQueue).toHaveLength(1);
    expect(data.messages[0].text.match(/media\/muse-1-image.png/g)).toHaveLength(2);
    expect(data.messages[0].text).toContain('notes.md');
    expect(data.messages[0].text).not.toContain('media/muse-2-notes.md');
    expect(adapter.extract(document,muse,{includeMedia:false}).remoteQueue).toEqual([]);
  });
  it('captures Muse blob images nested in its clickable image bubbles', () => {
    const blob = 'blob:https://muse.ai/12345678-1234-1234-1234-123456789abc';
    const document = museDoc(message('1','user',`<button class="hatch-chat-groupable-bubble" aria-label="photo.png"><img src="${blob}" class="outline-media-protection-border" alt="Uploaded image"></button>`) +
      message('2','assistant',`<button class="hatch-chat-groupable-bubble"><img src="${blob}" class="outline-media-protection-border" alt="Output image"></button>`));
    const result = adapter.extract(document, muse);
    expect(result.remoteQueue).toHaveLength(1);
    expect(result.remoteQueue[0]).toMatchObject({ url: blob, kind: 'image' });
    expect(result.messages.map(item => item.text)).toEqual(['![Uploaded image](media/muse-1-img.png)', '![Output image](media/muse-1-img.png)']);
    expect(result.failedFetches).toHaveLength(0);
  });
  it('includes Perplexity-displayed images without adding source thumbnails or other media', () => {
    const result = adapter.extract(doc(turn('Show me', '<p>Here is the image</p><img src="https://images.example.test/generated/asset" alt="Generated image"><video src="https://images.example.test/movie.mp4"></video><div data-workflow-text-footer><img src="https://images.example.test/favicon.png"></div>')), perplexity);
    expect(result.messages[1].text).toContain('![Generated image](media/perplexity-1-img.png)');
    expect(result.remoteQueue).toHaveLength(1);
    expect(result.remoteQueue[0]).toMatchObject({ url: 'https://images.example.test/generated/asset', kind: 'image' });
    expect(result.appendix).toBe('');
  });
  it('captures lazy and picture-backed images in private browser chats', () => {
    const document = museDoc(message('1','user',
      '<img data-src="https://muse.ai/lazy.png" alt="Lazy">' +
      '<picture><source srcset="https://muse.ai/low.webp 1x, https://muse.ai/high.webp 2x"><img alt="Picture"></picture>'));
    const data = adapter.extract(document, muse);
    expect(data.remoteQueue.map(item => item.url)).toEqual(['https://muse.ai/lazy.png','https://muse.ai/high.webp']);
    expect(data.messages[0].text).toContain('![Picture](media/');
  });
  it('keeps Muse file labels as text without downloading non-image attachments', () => {
    const document = museDoc(message('1','user',
      '<a href="https://muse.ai/api/file/opaque">notes.md</a>' +
      '<div data-download-url="https://muse.ai/api/file/another" aria-label="Attachment: plan.pdf">plan.pdf</div>' +
      '<button aria-label="Download draft.md">draft.md</button>'));
    const data = adapter.extract(document, muse);
    expect(data.remoteQueue).toHaveLength(0);
    expect(data.messages[0].text).toContain('notes.md');
    expect(data.messages[0].text).toContain('plan.pdf');
    expect(data.messages[0].text).toContain('draft.md');
    expect(data.failedFetches).toHaveLength(0);
  });
  it('keeps Muse image cards with opaque download URLs', () => {
    const document = museDoc(message('1','user','<div data-download-url="https://muse.ai/api/file/opaque" aria-label="photo.png">photo.png</div>'));
    const result = adapter.extract(document, muse);
    expect(result.remoteQueue).toHaveLength(1);
    expect(result.remoteQueue[0]).toMatchObject({ url: 'https://muse.ai/api/file/opaque', kind: 'image' });
    expect(result.messages[0].text).toContain('![photo.png](media/muse-1-photo.png)');
  });
  it('preserves code fences, tables, and safe links', () => {
    const data=adapter.extract(doc(turn('Format','<pre>```nested```</pre><table><tr><th>A</th></tr><tr><td>B</td></tr></table><a href="javascript:evil()">Safe text</a><script>secret</script>')),perplexity);
    expect(data.messages[1].text).toContain('````\n```nested```\n````');
    expect(data.messages[1].text).toContain('| A |\n| --- |\n| B |');
    expect(data.messages[1].text).not.toMatch(/javascript:|secret/);
  });
  it('keeps an artifact label without counting it as a failed Perplexity image', () => {
    const data=adapter.extract(doc(turn('Draft','<div><button>notes</button><div><button aria-label="Artifact options"></button></div></div>')),perplexity);
    expect(data.failedFetches).toHaveLength(0);
    expect(data.messages[1].text).toContain('Artifact shown in Perplexity: notes');
    const museArtifact = adapter.extract(museDoc(message('1','assistant','<div role="button" data-pel-click="space_proposal_view_space_click" aria-label="A dashboard"><p>A dashboard</p></div>')), muse);
    expect(museArtifact.failedFetches).toHaveLength(0);
    expect(museArtifact.messages[0].text).toContain('Artifact shown in Muse: A dashboard');
  });
  it('rejects empty and unrelated pages', () => {
    expect(()=>adapter.extract(doc('Sidebar only'),muse)).toThrow(/No Muse messages/);
    expect(()=>adapter.extract(museDoc(message('1','user','First') + message('1','assistant','Duplicate')),muse)).toThrow(/identities or roles changed/);
    expect(()=>adapter.extract(doc('Home'),'https://example.test')).toThrow(/unavailable/);
  });
  it('cancels during scanning and restores the scroll position', async () => {
    vi.useFakeTimers();
    try {
      const document=museDoc(message('1','user','Question'));
      document.documentElement.scrollTop=123;
      const controller=new AbortController();
      const pending=adapter.exportConversation(document,muse,{signal:controller.signal});
      controller.abort();
      await expect(pending).rejects.toMatchObject({name:'AbortError'});
      expect(document.documentElement.scrollTop).toBe(123);
    } finally { vi.useRealTimers(); }
  });
  it('does not call an accessibility-only Muse message a complete text export', async () => {
    vi.useFakeTimers();
    const document = museDoc(message('1', 'user', '<span data-message-accessibility-surrogate>User message: Partial preview</span>'));
    Object.defineProperty(document.documentElement, 'scrollHeight', { get: () => 100 });
    Object.defineProperty(document.documentElement, 'clientHeight', { get: () => 100 });
    try {
      const pending = adapter.exportConversation(document, muse, { includeMedia: false });
      const rejected = expect(pending).rejects.toThrow(/did not fully render/);
      await vi.runAllTimersAsync();
      await rejected;
    } finally { vi.useRealTimers(); }
  });
  it('walks Muse reverse scrolling and replaces every off-screen surrogate before a media export', async () => {
    vi.useFakeTimers();
    const document = doc(`<div id="feed"><div aria-label="Chat messages">${[0,1,2,3,4].map(i => message(String(i), i % 2 ? 'assistant' : 'user', '')).join('')}</div></div>`);
    const feed = document.querySelector('#feed');
    const nodes = [...document.querySelectorAll('[data-message-item]')];
    const previousStyle = document.defaultView.getComputedStyle;
    let position = 0;
    document.defaultView.getComputedStyle = node => ({ overflowY: node === feed ? 'auto' : 'visible' });
    const update = () => {
      const visible = Math.round((position + 400) / 100);
      nodes.forEach((node, index) => { node.innerHTML = index >= visible && index <= visible + 1
        ? `<p>Message ${index}</p>`
        : `<span data-message-accessibility-surrogate>${index % 2 ? 'Assistant' : 'User'} message: Message ${index}</span>`; });
    };
    Object.defineProperty(feed, 'scrollHeight', { get: () => 500 });
    Object.defineProperty(feed, 'clientHeight', { get: () => 100 });
    Object.defineProperty(feed, 'scrollTop', { get: () => position, set: value => { position = Math.max(-400, Math.min(0, value)); update(); } });
    update();
    try {
      const pending = adapter.exportConversation(document, muse, { includeMedia: true });
      await vi.runAllTimersAsync();
      const result = await pending;
      expect(result.messages.map(m => m.text)).toEqual([0,1,2,3,4].map(i => `Message ${i}`));
      expect(result.history.status).toBe('page-verified');
      expect(feed.scrollTop).toBe(0);
    } finally {
      document.defaultView.getComputedStyle = previousStyle;
      vi.useRealTimers();
    }
  });
  it('reassembles Perplexity virtual rows without omitting the first question', async () => {
    vi.useFakeTimers();
    const document = doc(`<div id="feed">${virtualRows(...Array(6).fill(''))}</div>`);
    const feed = document.querySelector('#feed');
    const rows = [...feed.querySelector('.flex.flex-col').children];
    const previousStyle = document.defaultView.getComputedStyle;
    let position = 500;
    document.defaultView.getComputedStyle = node => ({ overflowY: node === feed ? 'auto' : 'visible' });
    const update = () => {
      const visible = Math.floor(position / 100);
      rows.forEach((row, index) => { row.innerHTML = index >= visible && index <= visible + 1
        ? index % 2 ? `<div data-workflow-final-text>Answer ${index}</div>` : `<div class="group/user-bubble">Question ${index}</div>`
        : ''; });
    };
    Object.defineProperty(feed, 'scrollHeight', { get: () => 600 });
    Object.defineProperty(feed, 'clientHeight', { get: () => 100 });
    Object.defineProperty(feed, 'scrollTop', { get: () => position, set: value => { position = Math.max(0, Math.min(500, value)); update(); } });
    update();
    try {
      const pending = adapter.exportConversation(document, perplexity, { includeMedia: true });
      await vi.runAllTimersAsync();
      const result = await pending;
      expect(result.messages.map(m => m.text)).toEqual(['Question 0','Answer 1','Question 2','Answer 3','Question 4','Answer 5']);
      expect(result.messageCount).toBe(6);
      expect(feed.scrollTop).toBe(500);
    } finally {
      document.defaultView.getComputedStyle = previousStyle;
      vi.useRealTimers();
    }
  });
  it('visits Perplexity placeholders individually when a background scroll does not mount them', async () => {
    vi.useFakeTimers();
    const document = doc(`<div id="feed">${virtualRows(...Array(6).fill(''))}</div>`);
    const feed = document.querySelector('#feed');
    const rows = [...feed.querySelector('.flex.flex-col').children];
    const previousStyle = document.defaultView.getComputedStyle;
    const progress = [];
    let position = 500;
    const mount = index => {
      rows.forEach((row, i) => { row.innerHTML = i === index
        ? i % 2 ? `<div data-workflow-final-text>Answer ${i}</div>` : `<div class="group/user-bubble">Question ${i}</div>`
        : ''; });
    };
    rows.forEach((row, index) => { row.scrollIntoView = () => { position = index * 100; mount(index); }; });
    document.defaultView.getComputedStyle = node => ({ overflowY: node === feed ? 'auto' : 'visible' });
    Object.defineProperty(feed, 'scrollHeight', { get: () => 600 });
    Object.defineProperty(feed, 'clientHeight', { get: () => 100 });
    Object.defineProperty(feed, 'scrollTop', { get: () => position, set: value => { position = Math.max(0, Math.min(500, value)); } });
    mount(5);
    try {
      const pending = adapter.exportConversation(document, perplexity, { onProgress: message => progress.push(message) });
      await vi.runAllTimersAsync();
      const result = await pending;
      expect(result.messages.map(item => item.text)).toEqual(['Question 0','Answer 1','Question 2','Answer 3','Question 4','Answer 5']);
      expect(progress.join(' ')).toContain('Visiting unloaded positions individually');
      expect(feed.scrollTop).toBe(500);
    } finally {
      document.defaultView.getComputedStyle = previousStyle;
      vi.useRealTimers();
    }
  }, 30000);
  it.each(['complete', 'missing', 'cancel'])('handles delayed Perplexity recovery (%s) despite early background wake pulses', async outcome => {
    vi.useFakeTimers();
    const document = doc(`<div id="feed">${virtualRows(...Array(22).fill(''))}</div>`);
    const feed = document.querySelector('#feed');
    const rows = [...feed.querySelector('.flex.flex-col').children];
    const previousStyle = document.defaultView.getComputedStyle;
    const controller = new AbortController();
    let position = 9400, target = -1, pending;
    const missing = new Set([2, 9, 14]);
    const mount = index => { rows[index].innerHTML = index % 2
      ? `<div data-workflow-final-text>Answer ${index}</div>` : `<div class="group/user-bubble">Question ${index}</div>`; };
    rows.forEach((row, index) => {
      if (!missing.has(index)) mount(index);
      row.getBoundingClientRect = () => ({ top: index * 450 - position, height: index % 2 ? 952 : 196 });
      row.scrollIntoView = ({ block }) => {
        clearTimeout(pending);
        target = index;
        position = index * 450;
        if (outcome === 'cancel') { pending = setTimeout(() => controller.abort(), 100); return; }
        // A tall row requires another alignment; the others mount only after
        // more than the old scanner's entire two-sample recovery allowance.
        if (outcome !== 'missing' && (index !== 9 || block === 'end')) pending = setTimeout(() => { if (target === index) mount(index); }, 900);
      };
    });
    feed.getBoundingClientRect = () => ({ top: 0 });
    document.defaultView.getComputedStyle = node => ({ overflowY: node === feed ? 'auto' : 'visible' });
    Object.defineProperty(feed, 'scrollHeight', { get: () => 10261 });
    Object.defineProperty(feed, 'clientHeight', { get: () => 861 });
    Object.defineProperty(feed, 'scrollTop', { get: () => position, set: value => { position = Math.max(0, Math.min(9400, value)); } });
    const pulses = setInterval(() => document.dispatchEvent(new document.defaultView.Event('__exportWake')), 50);
    try {
      const resultPromise = adapter.exportConversation(document, perplexity, { signal: controller.signal });
      const failure = outcome === 'complete' ? null : expect(resultPromise).rejects.toThrow(outcome === 'cancel' ? /cancelled/ : /did not render 3 of 22/);
      await vi.advanceTimersByTimeAsync(60000);
      if (failure) await failure;
      else {
        const result = await resultPromise;
        expect(result.messageCount).toBe(22);
        expect(result.messages.map(item => item.text)).toEqual(rows.map((_, i) => `${i % 2 ? 'Answer' : 'Question'} ${i}`));
      }
      expect(feed.scrollTop).toBe(9400);
    } finally {
      clearInterval(pulses);
      clearTimeout(pending);
      document.defaultView.getComputedStyle = previousStyle;
      vi.useRealTimers();
    }
  });
});

it('preserves Muse and Perplexity providers and permissions in public snapshots', () => {
  const publicContext={ URL };
  const stub=publicFile('chrome-extension/privateBrowserAdapters.js',Buffer.from(source)).toString();
  vm.runInNewContext(stub,publicContext);
  expect(publicContext.AIChatExporterPrivateAdapters.names).toEqual(['Muse', 'Perplexity']);
  expect(publicContext.AIChatExporterPrivateAdapters.siteName(muse)).toBe('Muse');
  expect(publicContext.AIChatExporterPrivateAdapters.siteName(perplexity)).toBe('Perplexity');
  expect(typeof publicContext.AIChatExporterPrivateAdapters.exportConversation).toBe('function');
  const bytes=readFileSync(new URL('../chrome-extension/manifest.json',import.meta.url));
  const manifest=JSON.parse(publicFile('chrome-extension/manifest.json',bytes));
  expect(manifest.host_permissions).toContain('https://muse.ai/*');
  expect(manifest.host_permissions).toContain('https://www.perplexity.ai/*');
  expect(manifest.host_permissions.join(' ')).toMatch(/ppl-ai-file-upload/);
  expect(manifest.host_permissions.join(' ')).toContain('chatgpt.com');
});
