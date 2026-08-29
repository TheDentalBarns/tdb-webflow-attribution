(() => {
  'use strict';

  const FORM_SELECTOR = 'form[ms-code-submit-form]';
  const STORAGE_KEY = 'tdb_price_view_intent_v1';
  const PRICE_SELECTOR = '.pricing_item';
  const MAX_UNIQUE_ITEMS = 50;
  const MIN_VISIBLE_RATIO = 0.5;
  const MIN_VISIBLE_MS = 350;
  const observed = new WeakSet();
  const visibilityTimers = new WeakMap();
  const lastCountedAt = new WeakMap();

  function hasPerformanceConsent() {
    try {
      return Boolean(window.TDBAttribution?.consent?.().performance);
    } catch (error) {
      return false;
    }
  }

  function emptyState() {
    return { items: [], counts: {}, views: 0, last: '' };
  }

  function readState() {
    if (!hasPerformanceConsent()) return emptyState();
    try {
      const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
      return parsed && typeof parsed === 'object' ? { ...emptyState(), ...parsed } : emptyState();
    } catch (error) {
      return emptyState();
    }
  }

  function writeState(state) {
    if (!hasPerformanceConsent()) return;
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (error) {}
  }

  function clearState() {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch (error) {}
  }

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function priceTitle(item) {
    return cleanText(item.querySelector('[schema-price="title"]')?.textContent);
  }

  function recordView(item) {
    if (!hasPerformanceConsent()) return;
    const title = priceTitle(item);
    if (!title) return;

    const now = Date.now();
    const lastAt = Number(lastCountedAt.get(item)) || 0;
    if (now - lastAt < 1500) return;
    lastCountedAt.set(item, now);

    const state = readState();
    state.items ||= [];
    state.counts ||= {};
    state.views = (Number(state.views) || 0) + 1;
    state.last = title;
    state.counts[title] = (Number(state.counts[title]) || 0) + 1;
    if (!state.items.includes(title) && state.items.length < MAX_UNIQUE_ITEMS) state.items.push(title);
    writeState(state);
  }

  function setHiddenField(form, name, value) {
    let input = form.querySelector(`input[name="${name}"]`);
    if (!input) {
      input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.autocomplete = 'off';
      input.setAttribute('aria-hidden', 'true');
      form.appendChild(input);
    }
    input.value = value == null ? '' : String(value);
  }

  function populate(form) {
    const state = readState();
    state.items ||= [];
    state.counts ||= {};
    const counts = state.items.map((name) => [name, Number(state.counts[name]) || 0]);

    setHiddenField(form, 'tdb_price_viewed_items', state.items.join(' | '));
    setHiddenField(form, 'tdb_price_unique_viewed', state.items.length);
    setHiddenField(form, 'tdb_price_views', Number(state.views) || 0);
    setHiddenField(form, 'tdb_price_last_viewed', state.last || '');
    setHiddenField(
      form,
      'tdb_price_view_counts',
      counts.map(([name, count]) => `${name}=${count}`).join(' | '),
    );
  }

  const observer = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          const item = entry.target;
          const existingTimer = visibilityTimers.get(item);

          if (!entry.isIntersecting || entry.intersectionRatio < MIN_VISIBLE_RATIO) {
            if (existingTimer) clearTimeout(existingTimer);
            visibilityTimers.delete(item);
            return;
          }

          if (existingTimer) return;
          const timer = setTimeout(() => {
            visibilityTimers.delete(item);
            recordView(item);
          }, MIN_VISIBLE_MS);
          visibilityTimers.set(item, timer);
        });
      }, { threshold: [MIN_VISIBLE_RATIO] })
    : null;

  function observeItem(item) {
    if (!(item instanceof Element) || observed.has(item)) return;
    observed.add(item);
    if (observer) observer.observe(item);
    else recordView(item);
  }

  function discover(root = document) {
    if (root instanceof Element && root.matches(PRICE_SELECTOR)) observeItem(root);
    root.querySelectorAll?.(PRICE_SELECTOR).forEach(observeItem);
  }

  function start() {
    discover();
    const mutationObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
        if (node instanceof Element) discover(node);
      }));
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true });
  }

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (form instanceof HTMLFormElement && form.matches(FORM_SELECTOR)) populate(form);
  }, true);
  document.addEventListener('CookieScriptReject', clearState);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
