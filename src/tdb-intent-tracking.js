(() => {
  'use strict';

  const FORM_SELECTOR = 'form[ms-code-submit-form]';
  const PRICE_STORAGE_KEY = 'tdb_price_intent_v2';
  const SMILE_STORAGE_KEY = 'tdb_smile_intent_v2';
  const MAX_UNIQUE_ITEMS = 50;

  function hasPerformanceConsent() {
    try {
      return Boolean(window.TDBAttribution?.consent?.().performance);
    } catch (error) {
      return false;
    }
  }

  function readState(key, fallback) {
    if (!hasPerformanceConsent()) return fallback();

    try {
      const parsed = JSON.parse(window.sessionStorage.getItem(key) || 'null');
      return parsed && typeof parsed === 'object' ? parsed : fallback();
    } catch (error) {
      return fallback();
    }
  }

  function writeState(key, state) {
    if (!hasPerformanceConsent()) return;

    try {
      window.sessionStorage.setItem(key, JSON.stringify(state));
    } catch (error) {
      // Intent tracking must never interfere with the visitor journey.
    }
  }

  function clearIntentStorage() {
    try {
      window.sessionStorage.removeItem(PRICE_STORAGE_KEY);
      window.sessionStorage.removeItem(SMILE_STORAGE_KEY);
    } catch (error) {
      // Storage may be unavailable in restricted browsing contexts.
    }
  }

  function emptyPriceState() {
    return { items: [], counts: {}, total: 0, last: '' };
  }

  function emptySmileState() {
    return {
      items: [],
      counts: {},
      urls: {},
      opens: 0,
      last: '',
      lastUrl: '',
      next: 0,
      prev: 0,
    };
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

    input.value = value === null || value === undefined ? '' : String(value);
  }

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function linkPath(link) {
    try {
      return new URL(link.href, window.location.href).pathname;
    } catch (error) {
      return link.getAttribute('href') || '';
    }
  }

  function smileIdentifier(card) {
    return (
      cleanText(card.getAttribute('data-tdb-smile-cms-name')) ||
      cleanText(card.querySelector('[data-tdb-smile-title]')?.textContent) ||
      linkPath(card)
    );
  }

  function trackPriceClick(trigger) {
    const pricingItem = trigger.closest('.pricing_item');
    const title = cleanText(pricingItem?.querySelector('[schema-price="title"]')?.textContent);

    if (!title) return;

    const state = readState(PRICE_STORAGE_KEY, emptyPriceState);
    state.counts ||= {};
    state.total = (Number(state.total) || 0) + 1;
    state.last = title;
    state.counts[title] = (Number(state.counts[title]) || 0) + 1;

    if (!state.items.includes(title) && state.items.length < MAX_UNIQUE_ITEMS) {
      state.items.push(title);
    }

    writeState(PRICE_STORAGE_KEY, state);
  }

  function trackSmileOpen(card) {
    const identifier = smileIdentifier(card);

    if (!identifier) return;

    const state = readState(SMILE_STORAGE_KEY, emptySmileState);
    const url = linkPath(card);
    state.counts ||= {};
    state.urls ||= {};
    state.opens = (Number(state.opens) || 0) + 1;
    state.last = identifier;
    state.lastUrl = url;
    state.urls[identifier] = url;
    state.counts[identifier] = (Number(state.counts[identifier]) || 0) + 1;

    if (!state.items.includes(identifier) && state.items.length < MAX_UNIQUE_ITEMS) {
      state.items.push(identifier);
    }

    writeState(SMILE_STORAGE_KEY, state);
  }

  function trackSmileNavigation(direction) {
    const state = readState(SMILE_STORAGE_KEY, emptySmileState);
    state[direction] = (Number(state[direction]) || 0) + 1;
    writeState(SMILE_STORAGE_KEY, state);
  }

  function populatePriceFields(form) {
    const state = readState(PRICE_STORAGE_KEY, emptyPriceState);
    const itemCounts = state.items.map((name) => [name, Number(state.counts?.[name]) || 0]);

    let mostOpened = '';
    let mostOpenedCount = 0;

    itemCounts.forEach(([name, count]) => {
      if (count > mostOpenedCount) {
        mostOpened = name;
        mostOpenedCount = count;
      }
    });

    setHiddenField(form, 'tdb_price_items', state.items.join(' | '));
    setHiddenField(form, 'tdb_price_unique', String(state.items.length));
    setHiddenField(form, 'tdb_price_total', String(Number(state.total) || 0));
    setHiddenField(form, 'tdb_price_last', state.last || '');
    setHiddenField(
      form,
      'tdb_price_click_counts',
      itemCounts.map(([name, count]) => `${name}=${count}`).join(' | '),
    );
    setHiddenField(form, 'tdb_price_most_opened', mostOpened);
    setHiddenField(form, 'tdb_price_most_opened_count', String(mostOpenedCount));
  }

  function populateSmileFields(form) {
    const state = readState(SMILE_STORAGE_KEY, emptySmileState);
    const caseCounts = state.items.map((name) => [name, Number(state.counts?.[name]) || 0]);

    let mostOpened = '';
    let mostOpenedCount = 0;

    caseCounts.forEach(([name, count]) => {
      if (count > mostOpenedCount) {
        mostOpened = name;
        mostOpenedCount = count;
      }
    });

    setHiddenField(form, 'tdb_smile_cases', state.items.join(' | '));
    setHiddenField(form, 'tdb_smile_unique', String(state.items.length));
    setHiddenField(form, 'tdb_smile_opens', String(Number(state.opens) || 0));
    setHiddenField(form, 'tdb_smile_last', state.last || '');
    setHiddenField(form, 'tdb_smile_last_url', state.lastUrl || '');
    setHiddenField(
      form,
      'tdb_smile_open_counts',
      caseCounts.map(([name, count]) => `${name}=${count}`).join(' | '),
    );
    setHiddenField(
      form,
      'tdb_smile_case_urls',
      state.items.map((name) => `${name}=${state.urls?.[name] || ''}`).join(' | '),
    );
    setHiddenField(form, 'tdb_smile_most_opened', mostOpened);
    setHiddenField(form, 'tdb_smile_most_opened_count', String(mostOpenedCount));
    setHiddenField(form, 'tdb_smile_next_clicks', String(Number(state.next) || 0));
    setHiddenField(form, 'tdb_smile_prev_clicks', String(Number(state.prev) || 0));
  }

  function populateIntentFields(form) {
    populatePriceFields(form);
    populateSmileFields(form);
  }

  document.addEventListener(
    'click',
    (event) => {
      if (!hasPerformanceConsent() || !(event.target instanceof Element)) return;

      const priceTrigger = event.target.closest('[data-tdb-price-trigger]');
      const smileCard = event.target.closest('[data-tdb-smile-open]');
      const smileNext = event.target.closest('[data-tdb-smile-next]');
      const smilePrevious = event.target.closest('[data-tdb-smile-prev]');

      if (priceTrigger) trackPriceClick(priceTrigger);
      if (smileCard) trackSmileOpen(smileCard);
      if (smileNext) trackSmileNavigation('next');
      if (smilePrevious) trackSmileNavigation('prev');
    },
    true,
  );

  document.addEventListener(
    'submit',
    (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !form.matches(FORM_SELECTOR)) return;
      populateIntentFields(form);
    },
    true,
  );

  document.addEventListener('CookieScriptReject', clearIntentStorage);
})();
