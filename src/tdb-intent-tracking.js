(() => {
  'use strict';

  const FORM_SELECTOR = 'form[ms-code-submit-form]';
  const PRICE_STORAGE_KEY = 'tdb_price_intent_v2';
  const SMILE_STORAGE_KEY = 'tdb_smile_intent_v2';
  const MAX_UNIQUE_ITEMS = 50;
  const SMILE_COLLECTION_PATH = '/smile-gallery/';

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
      titles: {},
      urls: {},
      opens: 0,
      last: '',
      lastTitle: '',
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

  function normaliseEmbeddedMarkup(value) {
    return String(value || '')
      .replace(/\\\//g, '/')
      .replace(/&quot;/gi, '"')
      .replace(/&#34;/gi, '"')
      .replace(/&amp;/gi, '&');
  }

  function smileSlugFromValue(value) {
    const normalised = normaliseEmbeddedMarkup(value);
    const pathMatch = normalised.match(/\/smile-gallery\/([a-z0-9-]+)/i);
    if (pathMatch?.[1]) return pathMatch[1].toLowerCase();

    const idMatch = normalised.match(/\b([a-z0-9]+(?:-[a-z0-9]+)+-\d{3})\b/i);
    return idMatch?.[1]?.toLowerCase() || '';
  }

  function findSmileSlug(card) {
    const directValues = [
      card.getAttribute('data-tdb-smile-cms-slug'),
      card.getAttribute('data-tdb-smile-cms-name'),
      card.getAttribute('href'),
    ];

    for (const value of directValues) {
      const slug = smileSlugFromValue(value);
      if (slug) return slug;
    }

    const linkedCase = card.querySelector('a[href*="/smile-gallery/"]');
    const linkedSlug = smileSlugFromValue(linkedCase?.getAttribute('href'));
    if (linkedSlug) return linkedSlug;

    const schemaNodes = card.querySelectorAll(
      'script[type="application/ld+json"], .Image.Schema, .image-schema, [class*="Schema"], [class*="schema"]',
    );

    for (const node of schemaNodes) {
      const slug = smileSlugFromValue(`${node.textContent || ''} ${node.innerHTML || ''}`);
      if (slug) return slug;
    }

    return smileSlugFromValue(card.innerHTML);
  }

  function smileMetadata(card) {
    const title = cleanText(card.querySelector('[data-tdb-smile-title]')?.textContent);
    const slug = findSmileSlug(card);
    const explicitName = cleanText(card.getAttribute('data-tdb-smile-cms-name'));
    const identifier = slug || explicitName || title || linkPath(card);
    const url = slug ? `${SMILE_COLLECTION_PATH}${slug}` : linkPath(card);

    return { identifier, title, slug, url };
  }

  function migrateLegacySmileTitle(state, metadata) {
    const { identifier, title } = metadata;
    if (!identifier || !title || identifier === title || !state.items?.includes(title)) return;

    state.counts ||= {};
    state.titles ||= {};
    state.urls ||= {};

    const legacyCount = Number(state.counts[title]) || 0;
    state.counts[identifier] = (Number(state.counts[identifier]) || 0) + legacyCount;
    state.titles[identifier] = title;

    if (!state.urls[identifier] && state.urls[title]) {
      state.urls[identifier] = state.urls[title];
    }

    state.items = state.items.map((item) => (item === title ? identifier : item));
    state.items = state.items.filter((item, index, items) => items.indexOf(item) === index);

    delete state.counts[title];
    delete state.titles[title];
    delete state.urls[title];

    if (state.last === title) state.last = identifier;
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
    const metadata = smileMetadata(card);
    const { identifier, title, url } = metadata;

    if (!identifier) return;

    const state = readState(SMILE_STORAGE_KEY, emptySmileState);
    state.items ||= [];
    state.counts ||= {};
    state.titles ||= {};
    state.urls ||= {};

    migrateLegacySmileTitle(state, metadata);

    state.opens = (Number(state.opens) || 0) + 1;
    state.last = identifier;
    state.lastTitle = title;
    state.lastUrl = url;
    state.titles[identifier] = title;
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
    state.items ||= [];
    state.counts ||= {};
    state.titles ||= {};
    state.urls ||= {};

    const caseCounts = state.items.map((identifier) => [
      identifier,
      Number(state.counts?.[identifier]) || 0,
    ]);

    let mostOpened = '';
    let mostOpenedCount = 0;

    caseCounts.forEach(([identifier, count]) => {
      if (count > mostOpenedCount) {
        mostOpened = identifier;
        mostOpenedCount = count;
      }
    });

    setHiddenField(form, 'tdb_smile_cases', state.items.join(' | '));
    setHiddenField(form, 'tdb_smile_unique', String(state.items.length));
    setHiddenField(form, 'tdb_smile_opens', String(Number(state.opens) || 0));
    setHiddenField(form, 'tdb_smile_last', state.last || '');
    setHiddenField(form, 'tdb_smile_last_title', state.lastTitle || state.titles?.[state.last] || '');
    setHiddenField(form, 'tdb_smile_last_url', state.lastUrl || state.urls?.[state.last] || '');
    setHiddenField(
      form,
      'tdb_smile_open_counts',
      caseCounts.map(([identifier, count]) => `${identifier}=${count}`).join(' | '),
    );
    setHiddenField(
      form,
      'tdb_smile_case_titles',
      state.items
        .map((identifier) => `${identifier}=${state.titles?.[identifier] || ''}`)
        .join(' | '),
    );
    setHiddenField(
      form,
      'tdb_smile_case_urls',
      state.items
        .map((identifier) => `${identifier}=${state.urls?.[identifier] || ''}`)
        .join(' | '),
    );
    setHiddenField(form, 'tdb_smile_most_opened', mostOpened);
    setHiddenField(
      form,
      'tdb_smile_most_opened_title',
      mostOpened ? state.titles?.[mostOpened] || '' : '',
    );
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
