// Muse and Perplexity browser adapters.
globalThis.AIChatExporterExtraAdapters = (() => {
  function siteName(href) {
    try {
      const u = new URL(href);
      if (u.protocol !== 'https:') return '';
      if (/^(www\.)?muse\.ai$/.test(u.hostname) && (u.pathname === '/' || /^\/thread\/[^/?]+/.test(u.pathname))) return 'Muse';
      if (/^(www\.)?perplexity\.ai$/.test(u.hostname) && /^\/search\/[^/?]+/.test(u.pathname)) return 'Perplexity';
    } catch { /* Not a URL. */ }
    return '';
  }
  const querySelector = '[class~="group/user-bubble"]';
  function museEntries(doc) {
    const root = doc.querySelector('[aria-label="Chat messages"]');
    if (!root) throw new Error('No Muse messages have loaded. Open a side chat and retry.');
    const items = [...root.querySelectorAll('[data-message-item][data-message-id]')].map(node => ({
      key: node.getAttribute('data-message-id'), role: node.getAttribute('data-message-role'), node,
      surrogate: !!node.querySelector('[data-message-accessibility-surrogate]'),
    }));
    if (new Set(items.map(item => item.key)).size !== items.length || items.some(item => !['user','assistant'].includes(item.role))) {
      throw new Error('Muse message identities or roles changed. No partial conversation was saved.');
    }
    return items;
  }
  // Perplexity keeps one stable row per message, but replaces off-screen rows
  // with empty placeholders. The rows alternate question/answer. Do not look
  // for an answer in a question's ancestor: in a multi-turn chat that ancestor
  // is the whole thread and silently pairs the wrong turns.
  function perplexityRoot(doc) {
    let root = doc.querySelector('[data-workflow-final-text]')?.parentElement;
    while (root && !(root.children.length > 1 && [...root.children].every(child => child.classList.contains('w-full')))) root = root.parentElement;
    return root;
  }
  function perplexityRows(doc, knownRoot) {
    if (knownRoot) return readPerplexityRows(knownRoot);
    const answer = doc.querySelector('[data-workflow-final-text]');
    if (!answer) {
      if (doc.querySelector(querySelector)) throw new Error('A Perplexity answer has not finished loading. Retry after it finishes.');
      throw new Error('No Perplexity conversation has loaded. Open a search thread and retry.');
    }
    const root = perplexityRoot(doc);
    if (!root) return null;
    return readPerplexityRows(root);
  }
  function readPerplexityRows(root) {
    const rows = [...root.children];
    return rows.map((row, index) => {
      const query = row.querySelector(querySelector);
      const response = row.querySelector('[data-workflow-final-text]');
      if (query && response) throw new Error(`Perplexity row ${index + 1} contains both a question and an answer. The page layout changed.`);
      return { key: index, role: query ? 'user' : 'assistant', node: query || response, placeholder: !query && !response };
    });
  }
  function perplexityEntries(doc, { allowPlaceholders = false, root } = {}) {
    const rows = perplexityRows(doc, root);
    if (rows) {
      if (!allowPlaceholders && rows.some(row => row.placeholder)) throw new Error('Perplexity has unloaded older turns. The complete thread must be scanned before export.');
      return rows.filter(row => !row.placeholder);
    }
    // Small or older layouts can render a whole turn in one container.
    const result = [];
    for (const query of doc.querySelectorAll(querySelector)) {
      let turn = query.parentElement;
      while (turn && !turn.querySelector('[data-workflow-final-text]')) turn = turn.parentElement;
      if (!turn || turn.querySelectorAll(querySelector).length !== 1) throw new Error('A Perplexity answer has not finished loading, or the layout changed. Retry after it finishes.');
      const answer = turn.querySelector('[data-workflow-final-text]');
      result.push({ key: result.length, role: 'user', node: query }, { key: result.length + 1, role: 'assistant', node: answer });
    }
    return result;
  }
  function entries(doc, href, options) {
    const provider = siteName(href);
    if (provider === 'Muse') return museEntries(doc);
    if (provider === 'Perplexity') return perplexityEntries(doc, options);
    throw new Error('This provider is not supported.');
  }
  function renderEntries(items, doc, href, { includeMedia = true, supplementalFiles = null } = {}) {
    const provider = siteName(href), remoteQueue = [], media = new Map(), failedFetches = [];
    const fileExtension = /\.(md|txt|pdf|docx?|xlsx?|pptx?|csv|json|zip|png|jpe?g|webp|gif|avif|heic|bmp|tiff?|svg|mp[34]|mov|webm|wav|m4a)(?:[?#]|$)/i;
    const imageExtension = /\.(png|jpe?g|webp|gif|avif|heic|bmp|tiff?|svg)$/i;
    const labelFilename = value => String(value || '').split(/\s+/).map(token => token.replace(/^[[(,:]+|[)\],;]+$/g, '')).find(token => fileExtension.test(token)) || '';
    const namedFile = value => !!labelFilename(value);
    const label = value => String(value || '').replace(/[[\]\r\n]/g, ' ').trim();
    const srcsetUrl = value => {
      const candidates = String(value || '');
      if (candidates.startsWith('data:')) return candidates.split(/\s+/)[0];
      return candidates.split(',').at(-1)?.trim().split(/\s+/)[0] || '';
    };
    const url = value => {
      if (!value) return '';
      try {
        const u = new URL(value, href);
        if (!/^(https?:|blob:|data:)$/.test(u.protocol)) return '';
        if (u.hostname === 'l.meta.ai' && u.searchParams.has('u')) return url(u.searchParams.get('u'));
        return u.href.replace(/[<>\r\n]/g, '');
      } catch { return ''; }
    };
    const uploadKey = value => {
      try {
        const parsed = new URL(value, href);
        return parsed.hostname === 'ppl-ai-file-upload.s3.amazonaws.com' && parsed.pathname.startsWith('/web/direct-files/attachments/')
          ? `${parsed.origin}${parsed.pathname}` : '';
      } catch { return ''; }
    };
    const isImage = value => {
      try { return imageExtension.test(new URL(value, href).pathname); } catch { return false; }
    };
    const visibleFiles = provider === 'Perplexity' ? [...doc.querySelectorAll('a[href]')].flatMap(link => {
      const src = url(link.getAttribute('href'));
      if (!uploadKey(src) || !isImage(src)) return [];
      return [{ src, name: decodeURIComponent(new URL(src).pathname.split('/').pop() || 'image') }];
    }) : [];
    // The file pane supplies fresh signed URLs. Answer citations often retain
    // unsigned or expired variants of the same S3 object. Prefer the pane URL
    // and key by the immutable object path, not its changing query signature.
    const uploads = new Map();
    for (const file of visibleFiles) {
      const key = uploadKey(file.src);
      if (!key || !isImage(file.src)) continue;
      const prior = uploads.get(key);
      if (!prior || (!new URL(prior.src).search && new URL(file.src).search)) uploads.set(key, file);
    }
    for (const file of supplementalFiles || []) {
      const key = uploadKey(file.src);
      if (key && isImage(file.src)) uploads.set(key, file);
    }
    function asset(src, name, kind) {
      if (!includeMedia) return src;
      const key = provider === 'Perplexity' ? uploadKey(src) : '';
      const preferred = key && uploads.get(key);
      const canonical = preferred?.src || src;
      const identity = key || canonical;
      if (!media.has(identity)) {
        const safe = label(name).replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^\.+/, '') || 'attachment';
        const filename = `${provider.toLowerCase()}-${media.size + 1}-${safe}`;
        media.set(identity, filename); remoteQueue.push({ url: canonical, filename, kind });
      }
      return `media/${media.get(identity)}`;
    }
    function render(node) {
      if (node.nodeType === 3) return node.textContent;
      if (node.nodeType !== 1) return '';
      const tag = node.tagName.toLowerCase();
      if (provider === 'Perplexity' && node.matches('.citation')) {
        const linkedImage = tag === 'a' ? node : node.querySelector('a[href]');
        if (!linkedImage || !uploadKey(linkedImage.getAttribute('href')) || !isImage(linkedImage.getAttribute('href'))) return '';
      }
      // Perplexity's question bubble has a toolbar, shown on hover, with the
      // time it was asked and the copy and edit buttons. It is not the question.
      if (provider === 'Perplexity' && node.matches('[class*="group-hover/user-bubble"]')) return '';
      if (provider === 'Muse' && node.matches('[role="button"][data-pel-click="space_proposal_view_space_click"]')) {
        const name = label(node.getAttribute('aria-label')) || 'Muse artifact';
        const preview = node.querySelector('img[alt="Artifact preview"]');
        return preview ? render(preview) : `\n\n[Artifact shown in Muse: ${name}]\n\n`;
      }
      if (provider === 'Perplexity' && node.querySelector(':scope > button') && node.querySelector('button[aria-label="Artifact options"]')) {
        const preview = node.querySelector('img');
        const name = label(node.querySelector(':scope > button').textContent) || 'Artifact';
        return preview ? render(preview) : `\n\n[Artifact shown in Perplexity: ${name}]\n\n`;
      }
      if (tag !== 'a') {
        const name = label(node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent).slice(0, 200);
        const direct = url(node.getAttribute('data-download-url') || node.getAttribute('data-file-url') || node.getAttribute('data-attachment-url'));
        if (direct && (namedFile(name) || namedFile(direct))) {
          if (!isImage(direct) && !isImage(name)) return name;
          const target = asset(direct, name || new URL(direct).pathname.split('/').pop(), 'image');
          return `\n\n![${name || 'Image'}](${target.startsWith('media/') ? target : `<${target}>`})\n\n`;
        }
        if ((tag === 'button' || node.getAttribute('role') === 'button') && namedFile(name) && !node.querySelector('a[href],img.outline-media-protection-border')) {
          if (!isImage(name)) return name;
          if (includeMedia) failedFetches.push({ filename: name, url: href, reason: 'This image card has no direct image URL.' });
          return `\n\n[Image unavailable in export: ${name}]\n\n`;
        }
      }
      if (provider === 'Muse' && tag === 'button') return museButton(node, false);
      // Muse keeps cards, image choices and reply options in a copy-excluded
      // area beside the message actions. Keep their content, not the action
      // buttons or the hidden "You:" label.
      if (provider === 'Muse' && node.matches('[data-copy-exclude]')) {
        return [...node.querySelectorAll('button, section')]
          .filter(item => !item.parentElement.closest('button, section') && !item.closest('[aria-hidden="true"],[hidden]'))
          .map(item => item.tagName === 'SECTION' ? museCard(item) : museButton(item, true)).join('');
      }
      if (node.matches('[data-copy-exclude],[data-message-accessibility-surrogate],[data-workflow-text-footer],[hidden],[aria-hidden="true"],.sr-only') || ['script','style','svg','button','input','textarea'].includes(tag)) return '';
      if (tag === 'img' || tag === 'video' || tag === 'audio') {
        if (tag !== 'img') return '';
        const picture = node.parentElement?.tagName === 'PICTURE' ? node.parentElement.querySelector('source') : null;
        const src = url(node.currentSrc || node.getAttribute('src') || node.getAttribute('data-src') ||
          node.getAttribute('data-original') || srcsetUrl(node.getAttribute('srcset') || node.getAttribute('data-srcset') || picture?.getAttribute('srcset')) ||
          node.querySelector('source')?.getAttribute('src'));
        if (!src || node.closest('[aria-hidden="true"],.space-icon,[class*="avatar"],[class*="favicon"]')) return '';
        // Icons bundled with the Muse app, such as connector logos, are not
        // conversation images.
        if (provider === 'Muse' && /^\/_next\/static\//.test(new URL(src).pathname)) return '';
        const name = new URL(src).pathname.split('/').pop();
        const filename = /\.[a-z0-9]{2,5}$/i.test(name) ? name : `${tag}.${tag === 'img' ? 'png' : tag === 'video' ? 'mp4' : 'mp3'}`;
        const target = asset(src, filename, tag === 'img' ? 'image' : tag);
        return `\n\n${tag === 'img' ? '!' : ''}[${label(node.getAttribute('alt')) || tag}](${target.startsWith('media/') ? target : `<${target}>`})\n\n`;
      }
      if (tag === 'pre') {
        const text = node.textContent;
        const fence = '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map(m => m[0].length + 1)));
        return `\n\n${fence}\n${text}\n${fence}\n\n`;
      }
      if (tag === 'table') {
        const rows = [...node.querySelectorAll('tr')].filter(r => r.closest('table') === node).map(r => [...r.children].map(c => render(c).trim().replace(/\|/g, '\\|').replace(/\n/g, '<br>')));
        if (!rows.length) return '';
        const width = Math.max(...rows.map(r => r.length));
        const line = r => '| ' + Array.from({ length: width }, (_, i) => r[i] || '').join(' | ') + ' |';
        return '\n\n' + [line(rows[0]), line(Array(width).fill('---')), ...rows.slice(1).map(line)].join('\n') + '\n\n';
      }
      const text = [...node.childNodes].map(render).join('');
      if (tag === 'a') {
        let target = url(node.getAttribute('href') || node.getAttribute('data-download-url') || node.getAttribute('data-file-url') || node.getAttribute('data-attachment-url'));
        if (!target) return text;
        const filename = node.getAttribute('download') || labelFilename(text) || new URL(target).pathname.split('/').pop();
        if (provider === 'Perplexity' && uploadKey(target)) {
          if (!isImage(target)) return text.trim();
          target = asset(target, filename, 'image');
          return `![${label(text) || label(filename) || 'Image'}](${target.startsWith('media/') ? target : `<${target}>`})`;
        }
        if (node.querySelector('img')) return text;
        if (node.hasAttribute('download') || fileExtension.test(target) || namedFile(text)) {
          if (!isImage(target) && !isImage(filename)) return text.trim() || label(filename);
          target = asset(target, filename, 'image');
          return `![${label(text) || label(filename) || 'Image'}](${target.startsWith('media/') ? target : `<${target}>`})`;
        }
        return `[${text.trim() || label(node.getAttribute('aria-label')) || 'Source'}](${target.startsWith('media/') ? target : `<${target}>`})`;
      }
      if (tag === 'br') return '\n';
      if (tag === 'li') return '\n- ' + text.trim() + '\n';
      if (/^h[1-6]$/.test(tag)) return '\n\n' + '#'.repeat(Number(tag[1])) + ' ' + text.trim() + '\n\n';
      if (tag === 'strong' || tag === 'b') return `**${text}**`;
      if (tag === 'em' || tag === 'i') return `*${text}*`;
      if (tag === 'code') { const fence = '`'.repeat(Math.max(1, ...[...text.matchAll(/`+/g)].map(m => m[0].length + 1))); return `${fence} ${text} ${fence}`; }
      return ['p','div','section','ul','ol'].includes(tag) ? '\n\n' + text + '\n\n' : text;
    }
    // Muse renders much of a message's content as buttons. Message actions
    // (reply, copy, menus, reactions) carry no text of their own, or name an
    // analytics action, and are left out.
    // A card's own text, quoted so it stands apart from the message.
    function museCard(node) {
      const card = [...node.childNodes].map(render).join('').replace(/\n{3,}/g, '\n\n').trim();
      return card ? `\n\n${card.split('\n').map(line => line ? `> ${line}` : '>').join('\n')}\n\n` : '';
    }
    // Text Muse shows in a message, for a widget none of the rules above
    // know. Action buttons are labelled and carry no text of their own.
    function museVisibleText(node) {
      const texts = [];
      const walker = node.ownerDocument.createTreeWalker(node, 4);
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        const value = text.textContent.replace(/\s+/g, ' ').trim();
        if (!value || text.parentElement.closest('[aria-hidden="true"],[hidden],.sr-only,[data-message-accessibility-surrogate],svg,script,style,button[aria-label]')) continue;
        if (value === 'You:') continue;
        texts.push(value);
      }
      return texts.join('\n\n');
    }
    function museButton(node, inActions) {
      const action = node.getAttribute('data-pel-click') || '';
      // Idea, shopping and similar cards: a title and description.
      if (/_(card|row|entity)_click$/.test(action)) return museCard(node);
      // Uploaded, generated and offered images. The label is UI chrome.
      if (node.querySelector('img')) return [...node.querySelectorAll('img')].map(render).join('');
      // A file chip without a preview: its name is the content, as for the
      // named file buttons above.
      if (node.classList.contains('hatch-chat-groupable-bubble')) return label(node.getAttribute('aria-label') || node.textContent);
      // A reply option the assistant offered, such as "Yes, send it".
      const text = label(node.textContent);
      if (inActions && text && !action && !node.hasAttribute('aria-label')) return `\n\n[Reply option: ${text}]\n\n`;
      return '';
    }
    const messages = items.map(item => {
      const fallback = item.node.querySelector('[data-message-accessibility-surrogate]');
      let text = (fallback ? fallback.textContent.replace(/^(User|Assistant) message:\s*/i, '') : render(item.node)).replace(/\n{3,}/g, '\n\n').trim();
      if (!text && provider === 'Muse') text = museVisibleText(item.node);
      if (!text) throw new Error(`${provider} message ${item.key} did not render. No partial export was saved.`);
      return { role: item.role === 'user' ? '## You' : `## ${provider}`, text };
    });
    if (!messages.length) throw new Error(`No ${provider} messages have loaded. Open a conversation and retry.`);
    const firstQuestion = messages.find(m => m.role === '## You')?.text.split('\n')[0] || '';
    // Muse names a chat in the page title, for example "Chat" followed by
    // the agent's name. A tab that has not finished loading shows only "Muse".
    const pageTitle = provider === 'Muse' && doc.title && doc.title.trim() !== 'Muse' ? doc.title.trim().slice(0, 140) : '';
    const title = pageTitle || firstQuestion.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[[^\]]*\]\([^)]*\)/g, '').replace(/\s+/g, ' ').slice(0, 140).trim() || doc.title || provider;
    const missingImages = provider === 'Perplexity' && includeMedia
      ? [...uploads.entries()].filter(([key]) => !media.has(key)).map(([, file]) => ({ name: file.name, target: asset(file.src, file.name, 'image') }))
      : [];
    const appendix = missingImages.length
      ? `## Images from this conversation\n\n${missingImages.map(file => `- ![${label(file.name)}](${file.target})`).join('\n')}\n`
      : '';
    return { title,
      siteName: provider, date: new Date().toISOString(), messages, messageCount: messages.length,
      savedMedia: [], remoteQueue, failedFetches, appendix };
  }
  function extract(doc, href, options) { return renderEntries(entries(doc, href), doc, href, options); }
  async function collectPerplexityReferences(doc, href, wait, check) {
    const button = name => [...doc.querySelectorAll('button[aria-expanded]')].find(node => new RegExp(`^${name}\\s*(?:\\d+)?$`).test(node.textContent?.replace(/\s+/g, ' ').trim() || ''));
    const expanded = node => node?.getAttribute('aria-expanded') === 'true';
    const sourcesButton = button('Sources');
    const originalSources = expanded(sourcesButton);
    const original = {};
    const result = { files: [] };
    const emitScroll = node => { try { node.dispatchEvent(new (doc.defaultView?.Event || Event)('scroll', { bubbles: true })); } catch { /* Native scroll event also fires. */ } };
    try {
      if (sourcesButton && !originalSources) { sourcesButton.click(); await wait(); check(); }
      original.Files = expanded(button('Files'));
      for (const name of ['Files']) {
        let trigger = button(name);
        if (!trigger) continue;
        const count = Number(trigger.textContent?.match(new RegExp(`${name}\\s*(\\d+)`))?.[1] || 0);
        if (!count) continue;
        if (!expanded(trigger)) { trigger.click(); await wait(); check(); trigger = button(name); }
        if (!trigger || !expanded(trigger)) throw new Error(`Perplexity could not open its ${name.toLowerCase()} references. No partial export was saved.`);
        const section = trigger.parentElement;
        const scroll = [...section.querySelectorAll('*')].filter(node => node.scrollHeight > node.clientHeight + 10 && /auto|scroll/.test(doc.defaultView?.getComputedStyle?.(node)?.overflowY || '')).sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0];
        const scrollPosition = scroll?.scrollTop;
        const collected = new Map();
        const capture = () => {
          for (const link of section.querySelectorAll('a[href]')) {
            let src;
            try { src = new URL(link.getAttribute('href'), href); } catch { continue; }
            if (!/^https?:$/.test(src.protocol)) continue;
            if (src.hostname !== 'ppl-ai-file-upload.s3.amazonaws.com' || !src.pathname.startsWith('/web/direct-files/attachments/') || !/\.(png|jpe?g|webp|gif|avif|heic|bmp|tiff?|svg)$/i.test(src.pathname)) continue;
            collected.set(`${src.origin}${src.pathname}`, { src: src.href, name: decodeURIComponent(src.pathname.split('/').pop() || 'image') });
          }
        };
        try {
          if (scroll) { scroll.scrollTop = 0; emitScroll(scroll); await wait(120); }
          let stable = 0, last = '';
          while (stable < 3) {
            check(); capture();
            const bottom = !scroll || scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 2;
            const signature = `${scroll?.scrollTop}:${scroll?.scrollHeight}:${collected.size}`;
            stable = bottom && signature === last ? stable + 1 : 0;
            last = signature;
            if (scroll && !bottom) { scroll.scrollTop += Math.max(80, scroll.clientHeight * 0.75); emitScroll(scroll); }
            await wait(120);
          }
          result.files = [...collected.values()];
        } finally { if (scroll) scroll.scrollTop = scrollPosition; }
        const current = button(name);
        if (!original[name] && expanded(current)) { current.click(); await wait(); check(); }
      }
      return result;
    } finally {
      for (const name of ['Files']) {
        const trigger = button(name);
        if (trigger && original[name] && !expanded(trigger)) trigger.click();
      }
      const currentSources = button('Sources');
      if (currentSources && !originalSources && expanded(currentSources)) currentSources.click();
    }
  }
  async function exportConversation(doc, href, options = {}) {
    const provider = siteName(href);
    if (!provider) throw new Error('This provider is not supported.');
    const signal = options.signal;
    const progress = message => options.onProgress?.(message);
    const check = () => {
      if (signal?.aborted) throw Object.assign(new Error('Export cancelled.'), { name: 'AbortError' });
      if (doc.location?.href && doc.location.href !== href) throw new Error('The conversation changed during export. Retry on the intended chat.');
    };
    const wait = (delay = 250) => new Promise((resolve, reject) => {
      let timer;
      const deadline = Date.now() + delay;
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); doc.removeEventListener?.('__exportWake', wake); };
      // Background pulses rescue throttled timers, but must not shorten the
      // rendering interval when a pulse happens just after scrolling.
      const wake = () => { if (Date.now() < deadline) return; cleanup(); resolve(); };
      const abort = () => { cleanup(); reject(Object.assign(new Error('Export cancelled.'), { name: 'AbortError' })); };
      timer = setTimeout(wake, delay);
      doc.addEventListener?.('__exportWake', wake);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
    check();
    // A Muse tab that was reloaded or restored in the background stays on
    // "Loading chat" until it is shown. Muse's own router refresh, run by
    // museBackground.js, finishes the load without navigating.
    if (provider === 'Muse' && !doc.querySelector('[aria-label="Chat messages"] [data-message-item]')) {
      progress('Waiting for Muse to finish loading the chat...');
      const started = Date.now();
      let refreshed = started;
      while (!doc.querySelector('[aria-label="Chat messages"] [data-message-item]') && Date.now() - started < 30000) {
        if (Date.now() - refreshed >= (refreshed === started ? 3000 : 10000)) {
          refreshed = Date.now();
          doc.dispatchEvent(new (doc.defaultView?.Event || Event)('__aiExporterMuseRefresh'));
        }
        await wait(500);
        check();
      }
    }
    const threadRoot = provider === 'Perplexity' ? perplexityRoot(doc) : null;
    const initial = entries(doc, href, { allowPlaceholders: true, root: threadRoot });
    const first = initial[0]?.node;
    if (!first) throw new Error(`No ${provider} messages have loaded. Open a conversation and retry.`);
    let scroll = first.parentElement;
    while (scroll && !(scroll.scrollHeight > scroll.clientHeight + 10 && /auto|scroll/.test(doc.defaultView?.getComputedStyle?.(scroll)?.overflowY || ''))) scroll = scroll.parentElement;
    scroll ||= doc.scrollingElement || doc.documentElement;
    const original = scroll.scrollTop, originalAtBottom = original + scroll.clientHeight >= scroll.scrollHeight - 2, captured = new Map();
    let expectedKeys = [], expectedKeySet = new Set();
    const scanEntries = () => entries(doc, href, { allowPlaceholders: true, root: threadRoot });
    // Muse mounts only a window of a long chat (about 110 messages). At the
    // top, the newest messages are not in the page at all, so the message list
    // cannot be read in one go. Instead each mounted window is joined onto the
    // list as the sweep moves down. Windows overlap because each scroll step is
    // shorter than the viewport, so a window that shares no message with the
    // list means part of the chat was skipped.
    let museGap = false;
    const mergeMuseWindow = keys => {
      const anchor = keys.findIndex(key => expectedKeySet.has(key));
      if (anchor < 0) { if (keys.length) museGap = true; return; }
      const before = keys.slice(0, anchor).filter(key => !expectedKeySet.has(key));
      expectedKeys.splice(expectedKeys.indexOf(keys[anchor]), 0, ...before);
      for (const key of before) expectedKeySet.add(key);
      for (let i = anchor + 1; i < keys.length; i++) {
        if (expectedKeySet.has(keys[i])) continue;
        expectedKeys.splice(expectedKeys.indexOf(keys[i - 1]) + 1, 0, keys[i]);
        expectedKeySet.add(keys[i]);
      }
    };
    const capture = () => {
      const current = scanEntries();
      const keys = current.map(item => item.key);
      if (provider === 'Muse' && expectedKeys.length) mergeMuseWindow(keys);
      else if (expectedKeys.length && (keys.length > expectedKeys.length || keys.some(key => !expectedKeySet.has(key)))) throw new Error(`${provider} changed the conversation while it was being exported. Retry after the chat is stable.`);
      for (const item of current) {
        const previous = captured.get(item.key);
        if (!previous || !item.surrogate) captured.set(item.key, { ...item, node: item.node.cloneNode(true) });
      }
      return current;
    };
    const dispatchScroll = () => {
      try { scroll.dispatchEvent(new (doc.defaultView?.Event || Event)('scroll', { bubbles: true })); } catch { /* Setting scrollTop also fires the native scroll event. */ }
    };
    const dispatch = name => doc.dispatchEvent(new (doc.defaultView?.Event || Event)(name));
    // museBackground.js reports which history is still unloaded: "older",
    // "newer", both, or "complete". Null means the helper is not running.
    const museHistory = () => provider === 'Muse' ? doc.documentElement?.getAttribute?.('data-ai-exporter-muse-history') ?? null : null;
    const museMore = side => (museHistory() || '').split(' ').includes(side);
    // A history page can take several seconds, so a long pause is allowed
    // before giving up. Without the helper only a pause can mark the end.
    const historyPatience = 60000;
    let progressAt = 0;
    const historyProgress = message => { if (Date.now() - progressAt < 5000) return; progressAt = Date.now(); progress(message); };
    const finish = async () => {
      const ordered = expectedKeys.map(key => captured.get(key));
      if (provider === 'Perplexity' && ordered.some((item, index) => item.role !== (index % 2 ? 'assistant' : 'user'))) throw new Error('Perplexity did not render complete question and answer pairs. No partial conversation was saved.');
      const references = provider === 'Perplexity' ? await collectPerplexityReferences(doc, href, wait, check) : {};
      check();
      const result = renderEntries(ordered, doc, href, { ...options, supplementalFiles: references.files });
      result.history = { status: 'page-verified', basis: `Captured all ${ordered.length} ${provider} message positions exposed by the conversation page.` };
      return result;
    };
    try {
      // Capture the mounted tail before navigation. Perplexity replaces rows
      // outside the viewport with placeholders, including rows already seen.
      capture();
      if (provider === 'Muse') {
        dispatch('__aiExporterMuseStart');
        if (doc.documentElement?.getAttribute?.('data-ai-exporter-muse-rendered-rows') == null && options.requireBackgroundRendering) {
          throw new Error('Refresh this Muse chat once after updating the extension. The background rendering helper must load before the chat. No partial conversation was saved.');
        }
      }
      if (threadRoot) {
        threadRoot.setAttribute('data-ai-exporter-perplexity-root', '');
        dispatch('__aiExporterPerplexityStart');
        const tracked = threadRoot.getAttribute('data-ai-exporter-rendered-rows');
        if (tracked === null && options.requireBackgroundRendering && captured.size < threadRoot.children.length) {
          throw new Error('Refresh this Perplexity chat once after updating the extension. The background rendering helper must load before the chat. No partial conversation was saved.');
        }
        if (Number(tracked) > 0) {
          expectedKeys = [...threadRoot.children].map((_, index) => index);
          expectedKeySet = new Set(expectedKeys);
          progress(`Rendering all ${expectedKeys.length} Perplexity message positions without scrolling or activating the tab...`);
          for (let sample = 0; sample < 40; sample++) {
            check();
            if (threadRoot.children.length !== expectedKeys.length) throw new Error('Perplexity changed its message positions during export. No partial conversation was saved.');
            capture();
            if (expectedKeys.every(key => captured.has(key))) {
              progress(`Verified ${captured.size}/${expectedKeys.length} Perplexity message positions.`);
              return await finish();
            }
            await wait();
          }
          throw new Error(`Perplexity rendered ${captured.size} of ${expectedKeys.length} message positions with the background helper. No partial conversation was saved.`);
        }
      }
      // Muse uses a column-reverse feed, where zero is the bottom and the top
      // has a negative scrollTop. Perplexity uses the conventional direction.
      scroll.scrollTop = -scroll.scrollHeight;
      const reverse = scroll.scrollTop < -2;
      if (!reverse) scroll.scrollTop = 0;
      dispatchScroll();
      // Muse loads older history in pages while the top is in view. With the
      // helper, keep going until it reports nothing older remains.
      const settle = provider === 'Muse' && museHistory() === null ? 12 : 4;
      let stable = 0, last = '', changedAt = Date.now();
      while (stable < settle || museMore('older')) {
        check(); await wait(); check();
        scroll.scrollTop = reverse ? -scroll.scrollHeight : 0;
        dispatchScroll();
        const current = scanEntries();
        const signature = `${scroll.scrollHeight}:${current.length}:${current[0]?.key}:${scroll.scrollTop}`;
        stable = signature === last ? stable + 1 : 0;
        last = signature;
        if (!stable) changedAt = Date.now();
        if (museMore('older')) {
          if (Date.now() - changedAt > historyPatience) throw new Error('Muse stopped loading older messages before reaching the start of the chat. No partial conversation was saved.');
          historyProgress(`Loading older Muse messages: ${current.length} mounted so far...`);
        }
      }
      if (provider === 'Perplexity' && threadRoot) expectedKeys = [...threadRoot.children].map((_, index) => index);
      else expectedKeys = scanEntries().map(item => item.key);
      expectedKeySet = new Set(expectedKeys);
      if (!expectedKeys.length) throw new Error(`No ${provider} messages were found at the start of the chat.`);
      if (provider === 'Perplexity') progress(`Perplexity thread exposes ${expectedKeys.length} message positions. Initial capture: ${captured.size}; mounted near start: ${scanEntries().length}; scroll position: ${Math.round(scroll.scrollTop)}px; viewport/content: ${Math.round(scroll.clientHeight)}/${Math.round(scroll.scrollHeight)}px.`);
      // Accessibility surrogates can omit attachment and formatting details,
      // even in text-only mode. Walk the feed twice before accepting them.
      const passes = 2;
      for (let pass = 0; pass < passes; pass++) {
        scroll.scrollTop = reverse ? -scroll.scrollHeight : 0;
        dispatchScroll();
        await wait();
        let bottomStable = 0, lastState = '', content = '', changedAt = Date.now(), nudgedAt = 0;
        while (bottomStable < 4) {
          check(); capture();
          const atEnd = reverse ? scroll.scrollTop >= -2 : scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 2;
          // After a jump to the top Muse unloads the newest messages and loads
          // them back in pages near the bottom. The end is not the end yet.
          const newer = museMore('newer');
          const bottom = atEnd && !newer;
          const signature = `${scroll.scrollTop}:${scroll.scrollHeight}:${captured.size}`;
          bottomStable = bottom && signature === lastState ? bottomStable + 1 : 0;
          lastState = signature;
          const loaded = `${scroll.scrollHeight}:${captured.size}:${expectedKeys.length}`;
          if (loaded !== content) { content = loaded; changedAt = Date.now(); }
          else if (atEnd && newer) {
            if (Date.now() - changedAt > historyPatience) throw new Error('Muse stopped loading newer messages before reaching the end of the chat. No partial conversation was saved.');
            historyProgress(`Loading newer Muse messages: ${captured.size} captured so far...`);
            // Muse loads the next newer page only after its sentinel has left
            // the view and come back, the way a reader scrolls.
            if (Date.now() - Math.max(changedAt, nudgedAt) > 3000) {
              nudgedAt = Date.now();
              scroll.scrollTop -= scroll.clientHeight;
              dispatchScroll();
              await wait();
              continue;
            }
          }
          if (!bottom) {
            const step = Math.max(120, scroll.clientHeight * 0.55);
            scroll.scrollTop += step;
            dispatchScroll();
          }
          await wait();
        }
        if (expectedKeys.every(key => captured.has(key) && (provider !== 'Muse' || !captured.get(key).surrogate))) break;
      }
      if (provider === 'Perplexity' && threadRoot && captured.size < expectedKeys.length) {
        progress(`Perplexity sweep captured ${captured.size}/${expectedKeys.length}. Visiting unloaded positions individually...`);
        for (const alignment of ['start', 'center', 'end']) {
          for (const key of expectedKeys) {
            check();
            if (captured.has(key)) continue;
            const row = threadRoot.children[key];
            if (!row) throw new Error('Perplexity changed its message positions during export. No partial conversation was saved.');
            try { row.scrollIntoView?.({ block: alignment, inline: 'nearest', behavior: 'instant' }); }
            catch { /* The geometry-based scroll below remains available. */ }
            dispatchScroll();
            // Virtual rows mount asynchronously. Keep the target in view while
            // waiting, rather than moving away after a single 250ms sample.
            for (let sample = 0; sample < 8 && !captured.has(key); sample++) {
              await wait();
              check();
              capture();
              if (captured.has(key)) break;
              const rect = row.getBoundingClientRect();
              const viewport = scroll.getBoundingClientRect();
              const height = rect.height || 0;
              const inset = alignment === 'start' ? Math.min(40, scroll.clientHeight / 4)
                : alignment === 'end' ? scroll.clientHeight - height
                  : (scroll.clientHeight - height) / 2;
              const delta = rect.top - viewport.top - inset;
              if (Math.abs(delta) > 2) {
                scroll.scrollTop += delta;
                dispatchScroll();
              }
            }
          }
          if (expectedKeys.every(key => captured.has(key))) break;
        }
        progress(`Perplexity targeted scan captured ${captured.size}/${expectedKeys.length} message positions.`);
      }
      if (museGap) throw new Error('Muse skipped part of the conversation while scrolling. No partial conversation was saved.');
      const missing = expectedKeys.filter(key => !captured.has(key));
      if (missing.length) throw new Error(`${provider} did not render ${missing.length} of ${expectedKeys.length} messages (scroll viewport ${Math.round(scroll.clientHeight)}px, content ${Math.round(scroll.scrollHeight)}px, position ${Math.round(scroll.scrollTop)}px). No partial conversation was saved.`);
      if (provider === 'Muse') {
        const surrogate = expectedKeys.filter(key => captured.get(key).surrogate);
        if (surrogate.length) throw new Error(`Muse did not fully render ${surrogate.length} message(s). No partial conversation was saved.`);
      }
      return await finish();
    } finally {
      if (provider === 'Muse') dispatch('__aiExporterMuseStop');
      if (threadRoot) {
        dispatch('__aiExporterPerplexityStop');
        threadRoot.removeAttribute('data-ai-exporter-perplexity-root');
      }
      scroll.scrollTop = provider === 'Perplexity' && originalAtBottom ? scroll.scrollHeight : original;
    }
  }
  return { names: ['Muse', 'Perplexity'], siteName, extract, exportConversation };
})();
