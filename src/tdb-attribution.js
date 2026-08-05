(() => {
  'use strict';

  const VERSION = '1.3.0';
  const STORAGE_KEY = 'tdb_attribution_v2';
  const LEGACY_STORAGE_KEY = 'tdb_attribution_v1';
  const SESSION_STORAGE_KEY = 'tdb_attribution_session_v1';
  const FORM_SELECTOR = 'form[ms-code-submit-form]';
  const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
  const MAX_JOURNEY_STEPS = 15;
  const CONSENT_CATEGORY = 'performance';
  const CONSENT_COOKIE_NAME = 'CookieScriptConsent';
  const CONFIG = {
    requireConsent: true,
    ...(window.TDBAttributionConfig || {})
  };

  const pageLoadedAt = Date.now();
  const currentUrl = safeUrl(window.location.href);
  const currentPath = normalizePath(currentUrl?.pathname || window.location.pathname || '/');
  const rawReferrer = document.referrer || '';
  const referrerUrl = safeUrl(rawReferrer);

  function safeUrl(value, base = window.location.origin) {
    if (!value) return null;
    try { return new URL(value, base); } catch (error) { return null; }
  }

  function normalizePath(value) {
    let path = value || '/';
    const parsed = safeUrl(path);
    if (parsed) path = parsed.pathname;
    path = String(path).split('?')[0].split('#')[0].replace(/\/{2,}/g, '/');
    if (!path.startsWith('/')) path = `/${path}`;
    if (path.length > 1) path = path.replace(/\/+$/, '');
    return path || '/';
  }

  function cleanFullUrl(url) {
    if (!url) return '';
    try {
      const copy = new URL(url.href);
      copy.hash = '';
      return copy.href.slice(0, 2048);
    } catch (error) { return ''; }
  }

  function normalizeHost(hostname) {
    return String(hostname || '').toLowerCase().replace(/^www\./, '');
  }

  function isSameSite(url) {
    return Boolean(url && normalizeHost(url.hostname) === normalizeHost(window.location.hostname));
  }

  function getParameter(params, ...names) {
    for (const name of names) {
      const value = params.get(name);
      if (value) return value.trim();
    }
    return '';
  }

  function looksLikePlatformId(value) {
    return /^\d{6,}$/.test(String(value || '').trim());
  }

  function extractCampaign(url) {
    const params = url?.searchParams || new URLSearchParams();
    const utmSource = getParameter(params, 'utm_source');
    const utmMedium = getParameter(params, 'utm_medium');
    const utmCampaign = getParameter(params, 'utm_campaign');
    const utmId = getParameter(params, 'utm_id');
    const utmContent = getParameter(params, 'utm_content');
    const utmTerm = getParameter(params, 'utm_term');
    return {
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      utm_id: utmId,
      utm_content: utmContent,
      utm_term: utmTerm,
      meta_campaign_id: getParameter(params, 'meta_campaign_id', 'campaign_id') || utmId || (looksLikePlatformId(utmCampaign) ? utmCampaign : ''),
      meta_adset_id: getParameter(params, 'meta_adset_id', 'adset_id') || (looksLikePlatformId(utmTerm) ? utmTerm : ''),
      meta_ad_id: getParameter(params, 'meta_ad_id', 'ad_id') || (looksLikePlatformId(utmContent) ? utmContent : ''),
      meta_placement: getParameter(params, 'meta_placement', 'placement'),
      fbclid: getParameter(params, 'fbclid'),
      gclid: getParameter(params, 'gclid'),
      gbraid: getParameter(params, 'gbraid'),
      wbraid: getParameter(params, 'wbraid'),
      msclkid: getParameter(params, 'msclkid'),
      ttclid: getParameter(params, 'ttclid'),
      li_fat_id: getParameter(params, 'li_fat_id')
    };
  }

  function hasCampaignEvidence(campaign) {
    return Object.values(campaign || {}).some(Boolean);
  }

  function platformFromSource(source, placement, referrerHost) {
    const value = `${source || ''} ${placement || ''} ${referrerHost || ''}`.toLowerCase();
    if (/instagram|\big\b/.test(value)) return 'instagram';
    if (/facebook|\bfb\b/.test(value)) return 'facebook';
    if (/meta/.test(value)) return 'meta';
    if (/google/.test(value)) return 'google';
    if (/bing|microsoft/.test(value)) return 'microsoft';
    if (/tiktok/.test(value)) return 'tiktok';
    if (/linkedin/.test(value)) return 'linkedin';
    if (/pinterest/.test(value)) return 'pinterest';
    if (/youtube/.test(value)) return 'youtube';
    if (/duckduckgo/.test(value)) return 'duckduckgo';
    if (/yahoo/.test(value)) return 'yahoo';
    if (/ecosia/.test(value)) return 'ecosia';
    return source ? source.toLowerCase() : '';
  }

  function classifyTouch(campaign, referrer) {
    const source = String(campaign?.utm_source || '').toLowerCase();
    const medium = String(campaign?.utm_medium || '').toLowerCase();
    const placement = String(campaign?.meta_placement || '').toLowerCase();
    const referrerHost = referrer?.hostname || '';
    const platform = platformFromSource(source, placement, referrerHost);
    const hasMeta = Boolean(campaign?.fbclid || campaign?.meta_campaign_id || campaign?.meta_adset_id || campaign?.meta_ad_id);
    const hasGoogleAds = Boolean(campaign?.gclid || campaign?.gbraid || campaign?.wbraid);
    const paidMedium = /^(paid|paid_social|social_paid|cpc|ppc|paid_search|display|retargeting)$/.test(medium);
    const socialMedium = /social/.test(medium);
    const organicSearchHost = /(^|\.)(google|bing|yahoo|duckduckgo|ecosia)\./i.test(referrerHost);
    const socialReferrerHost = /(instagram|facebook|tiktok|linkedin|pinterest|youtube)\./i.test(referrerHost);
    if (hasMeta || campaign?.ttclid || campaign?.li_fat_id) return { channel: 'paid_social', platform: platform || 'social' };
    if (hasGoogleAds || campaign?.msclkid || medium === 'paid_search') return { channel: 'paid_search', platform: platform || 'search' };
    if (paidMedium && (socialMedium || /instagram|facebook|meta|tiktok|linkedin|pinterest/.test(source))) return { channel: 'paid_social', platform: platform || 'social' };
    if (paidMedium) return { channel: medium === 'display' ? 'display' : 'paid_search', platform };
    if (/email|newsletter/.test(medium) || source === 'email') return { channel: 'email', platform: platform || 'email' };
    if (medium === 'organic' || organicSearchHost) return { channel: 'organic_search', platform: platform || 'search' };
    if (socialMedium || socialReferrerHost) return { channel: 'organic_social', platform: platform || 'social' };
    if (source || medium) return { channel: medium || 'campaign', platform };
    if (referrer && !isSameSite(referrer)) return { channel: 'referral', platform: platform || normalizeHost(referrer.hostname) };
    return { channel: 'direct', platform: '' };
  }

  function buildTouch(url, method, referrer = referrerUrl) {
    const campaign = extractCampaign(url);
    const classification = classifyTouch(campaign, referrer);
    return {
      path: normalizePath(url?.pathname || currentPath),
      url: cleanFullUrl(url),
      at: new Date(pageLoadedAt).toISOString(),
      method,
      initial_referrer: rawReferrer,
      channel: classification.channel,
      platform: classification.platform,
      ...campaign
    };
  }

  function createAttributionId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return `tdb_${window.crypto.randomUUID()}`;
    return `tdb_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  function safeDecode(value) {
    try { return decodeURIComponent(value); } catch (error) { return value; }
  }

  function uniqueStrings(values) {
    return [...new Set((Array.isArray(values) ? values : []).filter(Boolean).map(String))];
  }

  function readConsentCookie() {
    const row = document.cookie.split('; ').find(item => item.startsWith(`${CONSENT_COOKIE_NAME}=`));
    if (!row) return null;
    const raw = row.slice(CONSENT_COOKIE_NAME.length + 1);
    for (const candidate of [raw, safeDecode(raw)]) {
      try {
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === 'object') return parsed;
      } catch (error) {}
    }
    return null;
  }

  function normalizeConsentAction(value) {
    const action = String(value || '').toLowerCase();
    if (action === 'acceptall') return 'accept';
    if (action === 'accept' || action === 'reject') return action;
    return '';
  }

  function consentState() {
    let apiState = null;
    try { apiState = window.CookieScript?.instance?.currentState?.() || null; } catch (error) { apiState = null; }
    const cookie = readConsentCookie();
    const action = normalizeConsentAction(apiState?.action ?? apiState?.a ?? cookie?.action ?? cookie?.a);
    let categories = apiState?.categories ?? apiState?.c ?? cookie?.categories ?? cookie?.c ?? [];
    if (typeof categories === 'string') {
      try { categories = JSON.parse(categories); } catch (error) { categories = categories.split(','); }
    }
    categories = uniqueStrings(categories);
    if (action === 'accept' && !categories.includes('strict')) categories.push('strict');
    if (action === 'reject') categories = ['strict'];
    const consentTimeSeconds = Number(cookie?.consenttime ?? cookie?.t);
    const consentAt = Number.isFinite(consentTimeSeconds) && consentTimeSeconds > 0 ? new Date(consentTimeSeconds * 1000).toISOString() : '';
    return {
      status: action === 'accept' ? 'accepted_all' : action === 'reject' ? 'essential_only' : 'not_decided',
      action: action || 'undecided',
      decided: Boolean(action),
      performance: categories.includes(CONSENT_CATEGORY),
      categories,
      consent_at: consentAt,
      cookie_script_version: window.CookieScript?.instance?.version || ''
    };
  }

  function canUseStorage() {
    if (!CONFIG.requireConsent) return true;
    return consentState().performance;
  }

  function readJson(storage, key) {
    if (!canUseStorage()) return null;
    try {
      const value = JSON.parse(storage.getItem(key) || 'null');
      return value && typeof value === 'object' ? value : null;
    } catch (error) { return null; }
  }

  function writeJson(storage, key, value) {
    if (!canUseStorage()) return;
    try { storage.setItem(key, JSON.stringify(value)); } catch (error) {}
  }

  function migrateLegacyAttribution(legacy) {
    if (!legacy?.attribution_id) return null;
    const campaign = {
      utm_source: legacy.utm_source || '', utm_medium: legacy.utm_medium || '', utm_campaign: legacy.utm_campaign || '', utm_id: legacy.utm_id || '', utm_content: legacy.utm_content || '', utm_term: legacy.utm_term || '', meta_campaign_id: legacy.meta_campaign_id || '', meta_adset_id: legacy.meta_adset_id || '', meta_ad_id: legacy.meta_ad_id || '', meta_placement: legacy.meta_placement || '', fbclid: legacy.fbclid || '', gclid: legacy.gclid || '', gbraid: legacy.gbraid || '', wbraid: legacy.wbraid || '', msclkid: legacy.msclkid || '', ttclid: legacy.ttclid || '', li_fat_id: legacy.li_fat_id || ''
    };
    const legacyReferrer = safeUrl(legacy.initial_referrer || '');
    const classification = classifyTouch(campaign, legacyReferrer);
    const touch = { path: normalizePath(legacy.first_landing_path || '/'), url: legacy.first_landing_url || '', at: legacy.first_touch_at || new Date(pageLoadedAt).toISOString(), method: 'legacy_migration', initial_referrer: legacy.initial_referrer || '', channel: classification.channel, platform: classification.platform, ...campaign };
    return { schema_version: 2, attribution_id: legacy.attribution_id, first_touch: touch, last_touch: touch, visit_number: Number(legacy.visit_number) || 1, last_seen_at: Number(legacy.last_seen_at) || pageLoadedAt };
  }

  function readPersistentAttribution() {
    const current = readJson(window.localStorage, STORAGE_KEY);
    if (current?.attribution_id && current?.first_touch) return current;
    return migrateLegacyAttribution(readJson(window.localStorage, LEGACY_STORAGE_KEY));
  }

  function chooseIncomingTouch() {
    const currentCampaign = extractCampaign(currentUrl);
    if (hasCampaignEvidence(currentCampaign)) return buildTouch(currentUrl, 'current_url');
    if (referrerUrl && isSameSite(referrerUrl)) {
      const referrerCampaign = extractCampaign(referrerUrl);
      if (hasCampaignEvidence(referrerCampaign)) return buildTouch(referrerUrl, 'internal_referrer_recovery');
    }
    if (referrerUrl && !isSameSite(referrerUrl)) return buildTouch(currentUrl, 'external_referrer', referrerUrl);
    return buildTouch(currentUrl, 'direct');
  }

  function isMeaningfulNonDirectTouch(touch) {
    return Boolean(touch && (hasCampaignEvidence(touch) || touch.channel === 'referral' || touch.channel === 'organic_search' || touch.channel === 'organic_social' || touch.channel === 'email'));
  }

  function addJourneyPath(sessionState, path) {
    const normalized = normalizePath(path);
    const paths = Array.isArray(sessionState.journey_paths) ? sessionState.journey_paths : [];
    if (paths[paths.length - 1] === normalized) return;
    sessionState.page_count = (Number(sessionState.page_count) || 0) + 1;
    if (paths.length >= MAX_JOURNEY_STEPS) paths.splice(1, 1);
    paths.push(normalized);
    sessionState.journey_paths = paths;
  }

  function createSession(incomingTouch) {
    const sessionState = { session_started_at: new Date(pageLoadedAt).toISOString(), session_landing_path: incomingTouch.path || currentPath, journey_paths: [], page_count: 0, last_seen_at: pageLoadedAt };
    if (incomingTouch.method === 'internal_referrer_recovery') addJourneyPath(sessionState, incomingTouch.path);
    addJourneyPath(sessionState, currentPath);
    return sessionState;
  }

  const incomingTouch = chooseIncomingTouch();
  let persistent = readPersistentAttribution();
  let session = readJson(window.sessionStorage, SESSION_STORAGE_KEY);
  const previousSeenAt = Number(persistent?.last_seen_at) || 0;
  const timedOut = Boolean(previousSeenAt && pageLoadedAt - previousSeenAt > SESSION_TIMEOUT_MS);

  if (!persistent) {
    persistent = { schema_version: 2, attribution_id: createAttributionId(), first_touch: incomingTouch, last_touch: incomingTouch, visit_number: 1, last_seen_at: pageLoadedAt };
  } else {
    persistent.schema_version = 2;
    persistent.last_seen_at = pageLoadedAt;
    if (timedOut) { persistent.visit_number = (Number(persistent.visit_number) || 1) + 1; session = null; }
    if (isMeaningfulNonDirectTouch(incomingTouch)) persistent.last_touch = incomingTouch;
  }

  if (!session || timedOut) {
    session = createSession(incomingTouch);
  } else {
    session.last_seen_at = pageLoadedAt;
    if (incomingTouch.method === 'internal_referrer_recovery' && !session.journey_paths?.length) addJourneyPath(session, incomingTouch.path);
    addJourneyPath(session, currentPath);
  }

  function saveState() {
    persistent.last_seen_at = Date.now();
    session.last_seen_at = persistent.last_seen_at;
    writeJson(window.localStorage, STORAGE_KEY, persistent);
    writeJson(window.sessionStorage, SESSION_STORAGE_KEY, session);
  }

  function findInput(form, fieldName) {
    return Array.from(form.elements).find(element => element.name === fieldName);
  }

  function setHiddenField(form, fieldName, value) {
    let input = findInput(form, fieldName);
    if (!input) {
      input = document.createElement('input'); input.type = 'hidden'; input.name = fieldName; input.autocomplete = 'off'; input.setAttribute('aria-hidden', 'true'); form.appendChild(input);
    }
    input.value = value === null || value === undefined ? '' : String(value);
  }

  function formValues() {
    const first = persistent.first_touch || {};
    const last = persistent.last_touch || first;
    const consent = consentState();
    return {
      tdb_attribution_version: VERSION,
      tdb_attribution_id: persistent.attribution_id,
      tdb_attribution_method: first.method,
      tdb_first_landing_path: first.path,
      tdb_first_landing_url: first.url,
      tdb_first_touch_at: first.at,
      tdb_initial_referrer: first.initial_referrer,
      tdb_channel: first.channel,
      tdb_platform: first.platform,
      tdb_utm_source: first.utm_source,
      tdb_utm_medium: first.utm_medium,
      tdb_utm_campaign: first.utm_campaign,
      tdb_utm_id: first.utm_id,
      tdb_utm_content: first.utm_content,
      tdb_utm_term: first.utm_term,
      tdb_meta_campaign_id: first.meta_campaign_id,
      tdb_meta_adset_id: first.meta_adset_id,
      tdb_meta_ad_id: first.meta_ad_id,
      tdb_meta_placement: first.meta_placement,
      tdb_fbclid: first.fbclid,
      tdb_gclid: first.gclid,
      tdb_gbraid: first.gbraid,
      tdb_wbraid: first.wbraid,
      tdb_msclkid: first.msclkid,
      tdb_ttclid: first.ttclid,
      tdb_li_fat_id: first.li_fat_id,
      tdb_last_touch_path: last.path,
      tdb_last_touch_at: last.at,
      tdb_last_channel: last.channel,
      tdb_last_platform: last.platform,
      tdb_last_utm_source: last.utm_source,
      tdb_last_utm_medium: last.utm_medium,
      tdb_last_utm_campaign: last.utm_campaign,
      tdb_last_utm_id: last.utm_id,
      tdb_last_utm_content: last.utm_content,
      tdb_last_utm_term: last.utm_term,
      tdb_last_meta_campaign_id: last.meta_campaign_id,
      tdb_last_meta_adset_id: last.meta_adset_id,
      tdb_last_meta_ad_id: last.meta_ad_id,
      tdb_last_meta_placement: last.meta_placement,
      tdb_last_fbclid: last.fbclid,
      tdb_last_gclid: last.gclid,
      tdb_last_gbraid: last.gbraid,
      tdb_last_wbraid: last.wbraid,
      tdb_last_msclkid: last.msclkid,
      tdb_last_ttclid: last.ttclid,
      tdb_last_li_fat_id: last.li_fat_id,
      tdb_visit_number: persistent.visit_number,
      tdb_session_landing_path: session.session_landing_path,
      tdb_journey_paths: (session.journey_paths || []).join(' > '),
      tdb_page_count: session.page_count,
      tdb_submission_path: currentPath,
      tdb_submitted_at: '',
      tdb_cookie_consent_status: consent.status,
      tdb_cookie_consent_action: consent.action,
      tdb_cookie_consent_decided: consent.decided,
      tdb_cookie_performance_consent: consent.performance,
      tdb_cookie_consent_categories: consent.categories.join(','),
      tdb_cookie_consent_at: consent.consent_at,
      tdb_cookie_script_version: consent.cookie_script_version,
      tdb_attribution_storage_mode: canUseStorage() ? 'persistent' : 'memory_only'
    };
  }

  function populateForm(form) {
    Object.entries(formValues()).forEach(([name, value]) => setHiddenField(form, name, value));
  }

  function bindForm(form) {
    populateForm(form);
    if (form.dataset.tdbAttributionBound === 'true') return;
    form.dataset.tdbAttributionBound = 'true';
    form.addEventListener('submit', () => {
      saveState(); populateForm(form); setHiddenField(form, 'tdb_submission_path', currentPath); setHiddenField(form, 'tdb_submitted_at', new Date().toISOString());
    }, true);
  }

  function refreshAllForms() {
    document.querySelectorAll(FORM_SELECTOR).forEach(bindForm);
  }

  function inspectAddedNode(node) {
    if (!(node instanceof Element)) return;
    if (node.matches(FORM_SELECTOR)) bindForm(node);
    node.querySelectorAll?.(FORM_SELECTOR).forEach(bindForm);
  }

  function activateStorage() {
    if (!canUseStorage()) { refreshAllForms(); return; }
    const stored = readPersistentAttribution();
    const storedSession = readJson(window.sessionStorage, SESSION_STORAGE_KEY);
    if (stored?.attribution_id && stored.first_touch) {
      persistent = stored;
      if (isMeaningfulNonDirectTouch(incomingTouch)) persistent.last_touch = incomingTouch;
      persistent.last_seen_at = Date.now();
    }
    if (storedSession?.session_landing_path) { session = storedSession; addJourneyPath(session, currentPath); }
    saveState();
    refreshAllForms();
  }

  function handleConsentChange() {
    if (canUseStorage()) activateStorage(); else refreshAllForms();
  }

  function startFormTracking() {
    saveState();
    refreshAllForms();
    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => mutation.addedNodes.forEach(inspectAddedNode));
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startFormTracking, { once: true });
  else startFormTracking();

  ['CookieScriptLoaded', 'CookieScriptAccept', 'CookieScriptAcceptAll', 'CookieScriptReject', 'CookieScriptClose', `CookieScriptCategory-${CONSENT_CATEGORY}`].forEach(eventName => {
    document.addEventListener(eventName, handleConsentChange);
  });

  window.TDBAttribution = Object.freeze({
    version: VERSION,
    refresh: refreshAllForms,
    consent: consentState,
    status: () => JSON.parse(JSON.stringify({ persistent, session, consent: consentState(), values: formValues() }))
  });
})();
