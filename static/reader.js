(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const search = $('#search'), input = $('#query'), results = $('#results'), status = $('#search-status');
  const help = $('#shortcuts'), singleKeys = $('#single-keys'), themeButton = $('#theme-toggle');
  const main = $('#main'), readerStatus = $('#reader-status');
  let indexPromise, version = 0, selected = -1, utilityOrigin, prefix = '', prefixTimer;
  try { singleKeys.checked = localStorage.getItem('forest-single-keys') !== 'off'; } catch { /* Use defaults. */ }
  singleKeys.addEventListener('change', () => {
    try { localStorage.setItem('forest-single-keys', singleKeys.checked ? 'on' : 'off'); } catch { /* Session only. */ }
  });
  function announce(message) { readerStatus.textContent = message; }
  function renderMath(root) {
    if (!window.katex) return;
    root.querySelectorAll('.org-math').forEach(node => {
      try { katex.render(node.dataset.tex, node, { displayMode:node.dataset.display === 'true', throwOnError:false, trust:false }); }
      catch { /* Keep original Org math when unsupported. */ }
    });
  }
  // Read the same published pages nginx serves. Only load a body when requested.
  const notePages = new Map(), previews = new WeakMap(), expanders = new WeakMap();
  let previewSerial = 0;
  function noteURL(link) {
    if (!link?.matches('a[href]')) return null;
    const url = new URL(link.href, location.href);
    return url.origin === location.origin && /^\/notes\/[^/]+\/$/.test(url.pathname) && !url.search && !url.hash ? url : null;
  }
  function loadNote(url) {
    const key = url.pathname;
    if (!notePages.has(key)) {
      if (notePages.size >= 20) notePages.delete(notePages.keys().next().value);
      const pending = fetch(key).then(response => {
        if (!response.ok) throw Error('note');
        return response.text();
      }).then(text => {
        const page = new DOMParser().parseFromString(text, 'text/html');
        const body = page.querySelector('#note');
        if (!body) throw Error('note');
        return body;
      });
      notePages.set(key, pending);
      pending.catch(() => { if (notePages.get(key) === pending) notePages.delete(key); });
    }
    return notePages.get(key);
  }
  function previewBody(source, prefix) {
    const body = source.cloneNode(true), ids = new Map();
    body.removeAttribute('id');
    body.className = 'preview-body';
    // Each occurrence owns its section anchors and footnotes.
    body.querySelectorAll('[id]').forEach(node => {
      const old = node.id; node.id = prefix + old; ids.set(old, node.id);
    });
    body.querySelectorAll('[href^="#"]').forEach(link => {
      let id;
      try { id = decodeURIComponent(link.getAttribute('href').slice(1)); } catch { return; }
      if (ids.has(id)) link.setAttribute('href', '#' + ids.get(id));
    });
    body.querySelectorAll('[aria-labelledby],[aria-describedby],[aria-controls],[for]').forEach(node => {
      for (const attribute of ['aria-labelledby', 'aria-describedby', 'aria-controls', 'for']) {
        if (node.hasAttribute(attribute)) node.setAttribute(attribute, node.getAttribute(attribute).split(/\s+/).map(id => ids.get(id) || id).join(' '));
      }
    });
    return body;
  }
  function makePreview(link, relation = false) {
    const url = noteURL(link);
    if (!url) return null;
    const wrapper = document.createElement('section'), details = document.createElement('details');
    const summary = document.createElement('summary'), heading = document.createElement('header');
    const content = document.createElement('div'), serial = ++previewSerial;
    wrapper.className = 'block transclusion linked-note' + (relation ? ' relation-note' : '');
    details.id = `preview-${serial}`;
    summary.title = 'Expand to read here; click the title to open the note';
    const title = relation ? link : link.cloneNode(true);
    if (!relation && title.classList.contains('slug')) {
      const label = link.closest('header')?.querySelector('.section-title, h1')?.cloneNode(true);
      if (label) {
        label.querySelectorAll('a.slug').forEach(node => node.remove());
        title.textContent = label.textContent.trim();
        title.classList.remove('slug'); title.removeAttribute('aria-label');
      }
    }
    summary.setAttribute('aria-label', `Read ${title.textContent.trim()} here`);
    title.classList.add('preview-title');
    heading.append(title);
    summary.append(heading);
    details.append(summary, content); wrapper.append(details);
    previews.set(link, details); previews.set(title, details);
    const control = expanders.get(link);
    if (control) control.setAttribute('aria-controls', details.id);
    let state = 'empty';
    details.addEventListener('toggle', async () => {
      if (control) {
        control.setAttribute('aria-expanded', String(details.open));
        control.textContent = details.open ? '▾' : '▸';
        control.setAttribute('aria-label', `${details.open ? 'Collapse' : 'Read'} ${link.textContent.trim()} here`);
        if (!details.open && details.contains(document.activeElement)) control.focus({ preventScroll:true });
        wrapper.hidden = !details.open;
      }
      if (!details.open || state !== 'empty') return;
      state = 'loading';
      content.setAttribute('aria-busy', 'true');
      const message = document.createElement('p');
      message.className = 'preview-status'; message.textContent = 'Loading note…'; content.replaceChildren(message);
      try {
        const body = previewBody(await loadNote(url), `preview-${serial}-`);
        renderMath(body);
        enhanceNoteLinks(body);
        content.replaceChildren(body); state = 'loaded';
      } catch {
        state = 'empty';
        message.textContent = 'Could not load this note. ';
        const retry = document.createElement('button');
        retry.type = 'button'; retry.className = 'text-control'; retry.textContent = 'Retry';
        retry.addEventListener('click', () => { details.dispatchEvent(new Event('toggle')); });
        message.append(retry, ' or open its title.');
      } finally {
        content.removeAttribute('aria-busy'); scheduleOutline();
      }
    });
    return { wrapper, details, summary, heading };
  }
  function expandLink(link) {
    if (!noteURL(link)) return false;
    let details = previews.get(link);
    if (!details) {
      const preview = makePreview(link);
      // Keep a complete block outside paragraphs, headings, tables and lists.
      const anchor = link.closest('table, summary, p, li, blockquote, .document-header') || link;
      if (anchor.tagName === 'LI') anchor.append(preview.wrapper);
      else anchor.after(preview.wrapper);
      details = preview.details;
    }
    details.open = !details.open;
    const control = expanders.get(link);
    if (control) details.parentElement.hidden = !details.open;
    focusNode(!details.open && control ? control : details.querySelector(':scope>summary'));
    return true;
  }
  function enhanceNoteLinks(root) {
    root.querySelectorAll('a[href]').forEach(link => {
      if (!noteURL(link) || link.closest('summary') || link.classList.contains('slug') || expanders.has(link)) return;
      const item = link.parentElement;
      // A list entry consisting of one linked note is already a tree row.
      // Reuse that title and replace its bullet with a native disclosure.
      const standalone = item.tagName === 'LI' && item.parentElement.tagName === 'UL' &&
        Array.from(item.childNodes).every(node => node === link || (node.nodeType === 3 && !node.textContent.trim()));
      if (standalone) {
        const preview = makePreview(link, true);
        item.append(preview.wrapper); item.classList.add('foldable-note');
        return;
      }
      const control = document.createElement('button');
      control.type = 'button'; control.className = 'note-expander'; control.textContent = '▸';
      control.setAttribute('aria-expanded', 'false');
      control.setAttribute('aria-label', `Read ${link.textContent.trim()} here`);
      control.title = 'Read this note here (e)';
      expanders.set(link, control); expanders.set(control, link);
      control.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); expandLink(link); });
      link.after(control);
    });
  }
  const noteBody = $('#note');
  if (noteBody) enhanceNoteLinks(noteBody);
  main.querySelectorAll('footer .backlinks>li').forEach(item => {
    const link = item.querySelector(':scope>a');
    const preview = makePreview(link, true);
    if (!preview) return;
    preview.heading.append(...item.childNodes);
    item.append(preview.wrapper); item.classList.add('expandable-relation');
    item.parentElement.classList.add('expandable-relations');
  });
  main.addEventListener('click', event => {
    if (event.button !== 0 || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (expandLink(event.target.closest('a'))) event.preventDefault();
  });
  function updateTheme() {
    const theme = document.documentElement.dataset.theme || 'system';
    const name = theme[0].toUpperCase() + theme.slice(1);
    const next = { system:'Light', light:'Dark', dark:'System' }[theme];
    themeButton.textContent = name;
    themeButton.setAttribute('aria-label', `Theme: ${name}. Switch to ${next}`);
    themeButton.title = `Theme: ${name}. Switch to ${next} (t)`;
  }
  function cycleTheme() {
    const theme = { system:'light', light:'dark', dark:'system' }[document.documentElement.dataset.theme || 'system'];
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('forest-theme', theme); } catch { /* Session only. */ }
    updateTheme();
    announce(`Theme: ${theme}`);
  }
  updateTheme();
  themeButton.addEventListener('click', cycleTheme);
  window.addEventListener('storage', event => {
    if (event.key === 'forest-theme') {
      document.documentElement.dataset.theme = ['light','dark'].includes(event.newValue) ? event.newValue : 'system';
      updateTheme();
    }
    if (event.key === 'forest-single-keys') singleKeys.checked = event.newValue !== 'off';
  });
  const modifiedClick = event => event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
  const isOpen = panel => panel.classList.contains('is-open') || location.hash === '#' + panel.id;
  function rememberPosition() {
    utilityOrigin ??= { element:document.activeElement, x:window.scrollX, y:window.scrollY };
  }
  function restorePosition(trigger) {
    const origin = utilityOrigin;
    utilityOrigin = null;
    (origin?.element?.isConnected ? origin.element : trigger).focus({ preventScroll:true });
    if (origin) window.scrollTo({ left:origin.x, top:origin.y, behavior:'instant' });
    scheduleOutline();
  }
  function hidePanel(panel, trigger, restore) {
    const wasOpen = isOpen(panel);
    panel.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
    if (location.hash === '#' + panel.id) history.replaceState(history.state, '', location.pathname + location.search);
    if (restore && wasOpen) restorePosition(trigger);
  }
  function closeSearch(restore = true) {
    hidePanel(search, $('#search-toggle'), restore);
    input.setAttribute('aria-expanded', 'false');
  }
  function closeHelp(restore = true) { hidePanel(help, $('#help-toggle'), restore); }
  function openSearch() {
    rememberPosition();
    closeHelp(false);
    search.classList.add('is-open');
    $('#search-toggle').setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-expanded', String(results.children.length > 0));
    search.scrollIntoView({ block:'nearest' });
    input.focus({ preventScroll:true });
    input.select();
  }
  function openHelp() {
    rememberPosition();
    closeSearch(false);
    help.classList.add('is-open');
    $('#help-toggle').setAttribute('aria-expanded', 'true');
    help.scrollIntoView({ block:'nearest' });
    help.focus({ preventScroll:true });
  }
  $('#search-toggle').addEventListener('click', event => { if (modifiedClick(event)) return; event.preventDefault(); isOpen(search) ? closeSearch() : openSearch(); });
  document.querySelectorAll('[data-open-search]').forEach(link => link.addEventListener('click', event => { if (modifiedClick(event)) return; event.preventDefault(); openSearch(); }));
  $('#search-close').addEventListener('click', () => closeSearch());
  $('#help-toggle').addEventListener('click', event => { if (modifiedClick(event)) return; event.preventDefault(); isOpen(help) ? closeHelp() : openHelp(); });
  $('#help-close').addEventListener('click', () => closeHelp());
  function selectResult(position) {
    if (!results.children.length) return;
    selected = Math.max(0, Math.min(position, results.children.length - 1));
    Array.from(results.children).forEach((node, i) => node.setAttribute('aria-selected', String(i === selected)));
    const item = results.children[selected];
    input.setAttribute('aria-activedescendant', item.id);
    if (isOpen(search) && document.activeElement === input) item.scrollIntoView({ block:'nearest' });
  }
  input.addEventListener('keydown', event => {
    if (event.isComposing) return;
    const down = event.key === 'ArrowDown' || (event.ctrlKey && event.key === 'n');
    const up = event.key === 'ArrowUp' || (event.ctrlKey && event.key === 'p');
    if (down || up) { event.preventDefault(); selectResult(selected + (down ? 1 : -1)); }
    if (event.key === 'Enter' && !event.altKey && !event.metaKey && !event.ctrlKey) {
      const link = results.children[selected]?.querySelector('a');
      if (link) { event.preventDefault(); link.click(); }
    }
  });
  input.addEventListener('input', async () => {
    const mine = ++version, q = input.value.trim().toLocaleLowerCase();
    results.replaceChildren(); selected = -1;
    input.removeAttribute('aria-activedescendant');
    input.setAttribute('aria-expanded', 'false');
    if (!q) { status.textContent = 'Search titles and text'; return; }
    status.textContent = 'Searching…';
    try {
      indexPromise ??= fetch('/search.json').then(response => {
        if (!response.ok) throw Error('search'); return response.json();
      }).then(index => index.map(n => ({ ...n, text:n.text || '', titleLower:n.title.toLocaleLowerCase(), parentLower:(n.parentTitle || '').toLocaleLowerCase(), textLower:(n.text || '').toLocaleLowerCase() })))
        .catch(error => { indexPromise = null; throw error; });
      const index = await indexPromise;
      if (mine !== version) return;
      const terms = q.split(/\s+/);
      const hits = index.map(n => ({ n, score:n.titleLower === q ? 0 : n.titleLower.includes(q) ? 1 : 2 }))
        .filter(({ n }) => terms.every(t => (n.titleLower + ' ' + n.parentLower + ' ' + n.textLower).includes(t)))
        .sort((a, b) => a.score - b.score || a.n.title.localeCompare(b.n.title));
      status.textContent = hits.length ? `${hits.length} ${hits.length === 1 ? 'match' : 'matches'}${hits.length > 40 ? ' · first 40 shown' : ''}` : 'No matches. Try a shorter title or another keyword.';
      for (const { n } of hits.slice(0, 40)) {
        const li = document.createElement('li'), a = document.createElement('a'), title = document.createElement('span'), p = document.createElement('p');
        li.id = `search-result-${results.children.length}`;
        li.setAttribute('role', 'option'); li.setAttribute('aria-selected', 'false'); li.setAttribute('aria-label', n.title + (n.parentTitle ? `, in ${n.parentTitle}` : ''));
        a.href = n.url; a.tabIndex = -1; title.className = 'result-title'; title.textContent = n.title;
        const at = Math.max(0, n.textLower.indexOf(terms[0]) - 35), excerpt = n.text.slice(at, at + 150);
        p.textContent = (at ? '…' : '') + excerpt + (at + 150 < n.text.length ? '…' : '');
        a.append(title);
        if (n.parentTitle) {
          const context = document.createElement('span');
          context.className = 'result-context'; context.textContent = `in ${n.parentTitle}`;
          a.append(context);
        }
        if (p.textContent) a.append(p);
        li.append(a); results.append(li);
      }
      input.setAttribute('aria-expanded', String(isOpen(search) && hits.length > 0));
      selectResult(0);
    } catch {
      if (mine === version) status.textContent = 'Search could not load. Edit the query to retry, or browse All notes.';
    }
  });
  function focusNode(node) {
    if (!node) return;
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      if (parent.tagName === 'DETAILS' && !(node.tagName === 'SUMMARY' && parent === node.parentElement)) parent.open = true;
    }
    node.focus({ preventScroll:true });
    node.scrollIntoView({ block:'nearest' });
    markOutline(node.closest('details'), true);
  }
  function reveal() {
    let id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
    if (id === 'search') { openSearch(); return; }
    if (id === 'shortcuts') { openHelp(); return; }
    const node = document.getElementById(id);
    if (!node) return;
    for (let parent = node; parent; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true;
    node.scrollIntoView({ block:'start' });
  }
  window.addEventListener('hashchange', reveal);
  document.querySelectorAll('#toc a[href^="#"]').forEach(link => link.addEventListener('click', event => {
    if (modifiedClick(event)) return;
    const node = document.getElementById(decodeURIComponent(link.hash.slice(1)));
    if (node) {
      event.preventDefault();
      if (location.hash !== link.hash) history.pushState(null, '', link.hash);
      node.open = true;
      focusNode(node.querySelector('summary'));
      node.scrollIntoView({ block:'start' });
    }
  }));
  const outline = $('#toc');
  const outlineItems = Array.from(document.querySelectorAll('#toc li[data-target]')).map(item => ({
    item, target:document.getElementById(item.dataset.target), link:item.querySelector('a')
  }));
  let outlineFrame = 0;
  function markOutline(target, bringIntoView = false) {
    for (const row of outlineItems) {
      const active = row.target === target;
      if (active) row.link.setAttribute('aria-current', 'location');
      else row.link.removeAttribute('aria-current');
      if (active && bringIntoView && outline && window.matchMedia('(min-width:1000px)').matches) {
        const bounds = outline.getBoundingClientRect(), rect = row.item.getBoundingClientRect();
        if (rect.top < bounds.top) outline.scrollTop -= bounds.top - rect.top;
        else if (rect.bottom > bounds.bottom) outline.scrollTop += rect.bottom - bounds.bottom;
      }
    }
  }
  function updateOutline() {
    outlineFrame = 0;
    let current = null;
    for (const row of outlineItems) {
      let hidden = !row.target;
      for (let parent = row.target?.parentElement; parent; parent = parent.parentElement) {
        if (parent.tagName === 'DETAILS' && !parent.open) hidden = true;
      }
      row.item.hidden = hidden;
      if (!hidden && row.target.querySelector('summary').getBoundingClientRect().top <= 100) current = row.target;
    }
    if (!isOpen(search) && !isOpen(help)) markOutline(current);
  }
  function scheduleOutline() {
    if (!outlineFrame) outlineFrame = requestAnimationFrame(updateOutline);
  }
  main.addEventListener('toggle', scheduleOutline, true);
  window.addEventListener('scroll', scheduleOutline, { passive:true });
  window.addEventListener('resize', scheduleOutline);
  updateOutline();
  const allTargets = () => Array.from(main.querySelectorAll('.document-header, .block>details>summary, .note-index .note-link'));
  const visibleTargets = () => allTargets().filter(node => {
    for (let parent = node.parentElement?.parentElement; parent; parent = parent.parentElement) if (parent.tagName === 'DETAILS' && !parent.open) return false;
    return true;
  });
  const currentTarget = () => document.activeElement.closest?.('.document-header, summary, .note-index .note-link');
  function move(direction) {
    const nodes = visibleTargets(), current = currentTarget(), at = nodes.indexOf(current);
    // Start near the reading position if focus is in prose or navigation.
    const next = at < 0 ? nodes.findIndex(node => node.getBoundingClientRect().top >= 0) : at + direction;
    focusNode(nodes[Math.max(0, Math.min(next < 0 ? nodes.length - 1 : next, nodes.length - 1))]);
  }
  function branch(direction) {
    const summary = currentTarget();
    if (!summary) return;
    if (summary.classList.contains('document-header')) {
      if (direction > 0) focusNode(main.querySelector('.block>details>summary'));
      return;
    }
    if (summary.tagName !== 'SUMMARY') return;
    const details = summary.parentElement;
    if (direction < 0) {
      if (details.open) details.open = false;
      else focusNode(details.parentElement.parentElement.closest('details')?.querySelector(':scope>summary') || $('.document-header'));
    } else if (!details.open) details.open = true;
    else focusNode(details.querySelector(':scope .block>details>summary'));
  }
  function clearPrefix() { prefix = ''; clearTimeout(prefixTimer); }
  function jump(key) {
    if (key === 'g') focusNode(visibleTargets()[0]);
    else if (key === 'h') location.assign('/');
    else if (key === 'a') location.assign('/all/');
    else if (key === 'b') {
      const backlinks = $('#backlinks');
      if (backlinks) focusNode(backlinks.querySelector('summary, a')); else announce('This note has no backlinks.');
    } else if (key === 't') {
      const toc = $('.toc-disclosure');
      if (toc) { toc.open = true; focusNode(toc.querySelector('a')); } else announce('This note has no table of contents.');
    }
  }
  document.addEventListener('keydown', event => {
    if (event.isComposing || event.defaultPrevented) return;
    const key = event.key;
    if ((event.metaKey || event.ctrlKey) && !event.altKey && key.toLowerCase() === 'k') { event.preventDefault(); clearPrefix(); openSearch(); return; }
    if (key === 'Escape') {
      clearPrefix();
      if (isOpen(search)) { event.preventDefault(); closeSearch(); }
      else if (isOpen(help)) { event.preventDefault(); closeHelp(); }
      else {
        const preview = document.activeElement.closest('.linked-note>details');
        if (preview?.open) { event.preventDefault(); preview.open = false; focusNode(preview.querySelector(':scope>summary')); }
      }
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || !singleKeys.checked) return;
    if (document.activeElement.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]')) return;
    if (prefix) { clearPrefix(); if ('ghabt'.includes(key)) { event.preventDefault(); jump(key); } return; }
    if (key === '/') { event.preventDefault(); openSearch(); }
    else if (key === '?') { event.preventDefault(); isOpen(help) ? closeHelp() : openHelp(); }
    else if (key === 't') { event.preventDefault(); cycleTheme(); }
    else if (isOpen(search) || isOpen(help)) return;
    else if (key === 'g') { event.preventDefault(); prefix = 'g'; prefixTimer = setTimeout(clearPrefix, 1200); }
    else if (key === 'G') { event.preventDefault(); focusNode(visibleTargets().at(-1)); }
    else if (key === 'j' || key === 'k') { event.preventDefault(); move(key === 'j' ? 1 : -1); }
    else if (key === 'h' || key === 'l') { event.preventDefault(); branch(key === 'h' ? -1 : 1); }
    else if (key === 'e') {
      const link = (document.activeElement.matches('.note-expander') && expanders.get(document.activeElement)) || document.activeElement.closest('a') || currentTarget()?.querySelector('a');
      if (expandLink(link)) event.preventDefault();
    }
    else if (key === 'o') {
      const current = currentTarget();
      const link = (document.activeElement.matches('.note-expander') && expanders.get(document.activeElement)) || document.activeElement.closest('a') || (current?.tagName === 'A' ? current : current?.querySelector('a.slug, a.preview-title'));
      if (link) { event.preventDefault(); link.click(); }
    }
  });
  document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('article .block:not(.root-tree)>details').forEach(details => {
      // Expand all must not fetch an entire backlink graph.
      if (!details.closest('.linked-note') || button.dataset.action === 'collapse') details.open = button.dataset.action === 'expand';
    });
  }));
  if (window.matchMedia('(max-width:999px)').matches) {
    const outline = $('.toc-disclosure'); if (outline) outline.open = false;
  }
  if (location.hash && performance.getEntriesByType('navigation')[0]?.type !== 'back_forward') reveal();
  renderMath(document);
})();
