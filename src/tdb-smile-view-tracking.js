(() => {
  'use strict';

  const FORM_SELECTOR = 'form[ms-code-submit-form]';
  const STORAGE_KEY = 'tdb_smile_view_intent_v1';
  const GALLERY_SELECTOR = '.gallery17_component .highlight-swiper_component';
  const MAX_UNIQUE_ITEMS = 50;
  const SMILE_COLLECTION_PATH = '/smile-gallery/';
  const attached = new WeakSet();
  const observed = new WeakSet();

  function hasPerformanceConsent() {
    try {
      return Boolean(window.TDBAttribution?.consent?.().performance);
    } catch (error) {
      return false;
    }
  }

  function emptyState() {
    return {
      items: [], counts: {}, titles: {}, urls: {}, views: 0,
      last: '', lastTitle: '', lastUrl: '', swipes: 0, swipeNext: 0, swipePrev: 0,
    };
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

  function normaliseMarkup(value) {
    return String(value || '').replace(/\\\//g, '/').replace(/&quot;|&#34;/gi, '"').replace(/&amp;/gi, '&');
  }

  function slugFromValue(value) {
    const normalised = normaliseMarkup(value);
    const pathMatch = normalised.match(/\/smile-gallery\/([a-z0-9-]+)/i);
    if (pathMatch?.[1]) return pathMatch[1].toLowerCase();
    const idMatch = normalised.match(/\b([a-z0-9]+(?:-[a-z0-9]+)+-\d{3})\b/i);
    return idMatch?.[1]?.toLowerCase() || '';
  }

  function metadata(slide) {
    const card = slide.matches?.('[data-tdb-smile-open]')
      ? slide
      : slide.querySelector?.('[data-tdb-smile-open]') || slide;
    const title = cleanText(card.querySelector?.('[data-tdb-smile-title]')?.textContent);
    const directValues = [
      card.getAttribute?.('data-tdb-smile-cms-slug'),
      card.getAttribute?.('data-tdb-smile-cms-name'),
      card.getAttribute?.('href'),
    ];
    let slug = '';
    for (const value of directValues) {
      slug = slugFromValue(value);
      if (slug) break;
    }
    if (!slug) {
      const linked = card.querySelector?.('a[href*="/smile-gallery/"]');
      slug = slugFromValue(linked?.getAttribute('href'));
    }
    if (!slug) slug = slugFromValue(card.innerHTML || '');
    const explicitName = cleanText(card.getAttribute?.('data-tdb-smile-cms-name'));
    const identifier = slug || explicitName || title;
    const url = slug ? `${SMILE_COLLECTION_PATH}${slug}` : '';
    return { identifier, title, url };
  }

  function recordView(slide) {
    if (!slide || !hasPerformanceConsent()) return;
    const { identifier, title, url } = metadata(slide);
    if (!identifier) return;
    const state = readState();
    state.items ||= []; state.counts ||= {}; state.titles ||= {}; state.urls ||= {};
    state.views = (Number(state.views) || 0) + 1;
    state.last = identifier; state.lastTitle = title; state.lastUrl = url;
    state.counts[identifier] = (Number(state.counts[identifier]) || 0) + 1;
    state.titles[identifier] = title; state.urls[identifier] = url;
    if (!state.items.includes(identifier) && state.items.length < MAX_UNIQUE_ITEMS) state.items.push(identifier);
    writeState(state);
  }

  function recordSwipe(direction) {
    const state = readState();
    state.swipes = (Number(state.swipes) || 0) + 1;
    if (direction === 'prev') state.swipePrev = (Number(state.swipePrev) || 0) + 1;
    else state.swipeNext = (Number(state.swipeNext) || 0) + 1;
    writeState(state);
  }

  function setHiddenField(form, name, value) {
    let input = form.querySelector(`input[name="${name}"]`);
    if (!input) {
      input = document.createElement('input'); input.type = 'hidden'; input.name = name;
      input.autocomplete = 'off'; input.setAttribute('aria-hidden', 'true'); form.appendChild(input);
    }
    input.value = value == null ? '' : String(value);
  }

  function populate(form) {
    const state = readState();
    state.items ||= []; state.counts ||= {}; state.titles ||= {}; state.urls ||= {};
    const counts = state.items.map((id) => [id, Number(state.counts[id]) || 0]);
    setHiddenField(form, 'tdb_smile_viewed_cases', state.items.join(' | '));
    setHiddenField(form, 'tdb_smile_unique_viewed', state.items.length);
    setHiddenField(form, 'tdb_smile_views', Number(state.views) || 0);
    setHiddenField(form, 'tdb_smile_last_viewed', state.last || '');
    setHiddenField(form, 'tdb_smile_last_viewed_title', state.lastTitle || state.titles[state.last] || '');
    setHiddenField(form, 'tdb_smile_last_viewed_url', state.lastUrl || state.urls[state.last] || '');
    setHiddenField(form, 'tdb_smile_view_counts', counts.map(([id, count]) => `${id}=${count}`).join(' | '));
    setHiddenField(form, 'tdb_smile_viewed_titles', state.items.map((id) => `${id}=${state.titles[id] || ''}`).join(' | '));
    setHiddenField(form, 'tdb_smile_viewed_urls', state.items.map((id) => `${id}=${state.urls[id] || ''}`).join(' | '));
    setHiddenField(form, 'tdb_smile_swipes', Number(state.swipes) || 0);
    setHiddenField(form, 'tdb_smile_swipe_next', Number(state.swipeNext) || 0);
    setHiddenField(form, 'tdb_smile_swipe_prev', Number(state.swipePrev) || 0);
  }

  function attach(component) {
    if (!component || attached.has(component)) return Boolean(component);
    const swiperEl = component.querySelector('.swiper');
    const swiper = swiperEl?.swiper;
    if (!swiper || typeof swiper.on !== 'function') return false;
    attached.add(component);
    let touchSequence = 0;
    let activeTouchSequence = 0;
    let countedTouchSequence = 0;
    swiper.on('touchStart', () => {
      activeTouchSequence = ++touchSequence;
    });
    swiper.on('slideChange', () => {
      recordView(swiper.slides?.[swiper.activeIndex]);
      if (activeTouchSequence && countedTouchSequence !== activeTouchSequence) {
        recordSwipe(swiper.swipeDirection === 'prev' ? 'prev' : 'next');
        countedTouchSequence = activeTouchSequence;
      }
    });
    swiper.on('touchEnd', () => {
      const endedSequence = activeTouchSequence;
      setTimeout(() => {
        if (activeTouchSequence === endedSequence) activeTouchSequence = 0;
      }, 0);
    });

    if ('IntersectionObserver' in window && !observed.has(component)) {
      observed.add(component);
      const observer = new IntersectionObserver((entries, current) => {
        if (!entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.35)) return;
        recordView(swiper.slides?.[swiper.activeIndex]);
        current.disconnect();
      }, { threshold: [0.35] });
      observer.observe(component);
    }
    return true;
  }

  function discover(root = document) {
    const components = [];
    if (root instanceof Element && root.matches(GALLERY_SELECTOR)) components.push(root);
    root.querySelectorAll?.(GALLERY_SELECTOR).forEach((node) => components.push(node));
    components.forEach((component) => {
      if (attach(component)) return;
      let tries = 0;
      const timer = setInterval(() => {
        tries += 1;
        if (attach(component) || tries >= 120) clearInterval(timer);
      }, 100);
    });
  }

  function start() {
    discover();
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
        if (node instanceof Element) discover(node);
      }));
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (form instanceof HTMLFormElement && form.matches(FORM_SELECTOR)) populate(form);
  }, true);
  document.addEventListener('CookieScriptReject', clearState);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
