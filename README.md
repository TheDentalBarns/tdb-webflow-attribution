# TDB Webflow Attribution

First-party attribution and journey capture for The Dental Barns Webflow forms.

## Version

Current source version: `1.5.2`

## Form scope

The runtime prepares hidden attribution fields only when a matching form submits:

```html
form[ms-code-submit-form]
```

This includes standard page forms and the shared VIP drawer form.

## Attribution model

- Persistent first touch in `localStorage`
- Latest meaningful non-direct touch in `localStorage`
- Current-session journey in `sessionStorage`
- 30-minute session timeout
- Maximum 15 stored journey steps
- Consecutive duplicate paths are removed
- Paths such as `//first-visit` are normalised to `/first-visit`
- Existing `tdb_attribution_v1` records are migrated automatically

Storage remains consent-gated by default. Without performance consent, attribution stays in memory. The existing configuration is:

```html
<script>
window.TDBAttributionConfig = { requireConsent: true };
</script>
```

## Recovery behaviour

When a visitor reaches another Dental Barns page before the runtime has persisted the original touch, the script inspects a same-site referrer containing acquisition evidence such as UTMs, `fbclid`, `gclid` or other click IDs.

Example:

```text
Instagram advert
→ /vip?...campaign parameters...
→ /dental-cost-lichfield
→ form submission
```

The stored result is:

```text
First landing: /vip
Journey: /vip > /dental-cost-lichfield
Submission page: /dental-cost-lichfield
Channel: paid_social
Platform: instagram
```

## Core reporting fields

- `tdb_attribution_version`
- `tdb_attribution_id`
- `tdb_attribution_method`
- `tdb_first_landing_path`
- `tdb_first_landing_url`
- `tdb_first_touch_at`
- `tdb_initial_referrer`
- `tdb_channel`
- `tdb_platform`
- `tdb_visit_number`
- `tdb_session_landing_path`
- `tdb_journey_paths`
- `tdb_page_count`
- `tdb_submission_path`
- `tdb_submitted_at`

## Campaign fields

First-touch fields retain their existing names for backward compatibility:

- `tdb_utm_source`
- `tdb_utm_medium`
- `tdb_utm_campaign`
- `tdb_utm_id`
- `tdb_utm_content`
- `tdb_utm_term`
- `tdb_meta_campaign_id`
- `tdb_meta_adset_id`
- `tdb_meta_ad_id`
- `tdb_meta_placement`
- `tdb_fbclid`
- `tdb_gclid`
- `tdb_gbraid`
- `tdb_wbraid`
- `tdb_msclkid`
- `tdb_ttclid`
- `tdb_li_fat_id`

Equivalent latest-touch fields use the `tdb_last_` prefix, including:

- `tdb_last_touch_path`
- `tdb_last_touch_at`
- `tdb_last_channel`
- `tdb_last_platform`
- `tdb_last_utm_source`
- `tdb_last_utm_medium`
- `tdb_last_utm_campaign`
- `tdb_last_meta_campaign_id`
- `tdb_last_meta_adset_id`
- `tdb_last_meta_ad_id`

## Meta mapping

The runtime recognises explicit Meta parameter names and Meta's common dynamic UTM mapping:

```text
utm_id or numeric utm_campaign → campaign ID
numeric utm_term               → ad set ID
numeric utm_content            → ad ID
placement                      → placement
```

## Runtime inspection

In the browser console:

```js
TDBAttribution.status()
```

returns a copy of the persistent state, current session and current form values.

## Repository structure

```text
src/tdb-attribution.js       readable source
dist/tdb-attribution.js      production distribution
dist/tdb-attribution.min.js  minified production distribution
```

## Webflow installation

Use a commit-pinned jsDelivr URL so production cannot change unexpectedly:

```html
<script defer src="https://cdn.jsdelivr.net/gh/TheDentalBarns/tdb-webflow-attribution@COMMIT_SHA/dist/tdb-attribution.js"></script>
```


## Submission-time fields (1.5.2)

The homepage release builds on the deployed Safari storage fix at
`6fa2423188ddccf9ef354132d3c1a303245e17a5`, keeping its core-only distribution.
Use `npm run build:core` for this release; the historical main-branch workflow
also concatenates separate intent/view trackers and is not the homepage build.

- Attribution collection starts as before; no attribution inputs are created on load.
- One document capture listener prepares the submitting form synchronously,
  before the existing Webflow serializer reads it. Native validation is retained.
- All 61 keys, empty strings, booleans, consent and storage rules are preserved.
- Existing matching inputs are reused; retries update values without duplication.
- Newly inserted forms work without a MutationObserver.
- `TDBAttribution.refresh()` updates only forms already prepared for submission.
- Inputs remain after an attempt so asynchronous consumers and retries can read
  them. No submission interception, new fetch, or timer is introduced.
- Programmatic submission should use `requestSubmit()`, which emits `submit`;
  direct `form.submit()` bypasses submit listeners and Webflow's AJAX handler.

### Homepage installation and rollback

Add one commit-pinned deferred script in the **homepage footer only**, with
`data-tdb-attribution-js="true"`. The existing immediate runtime finds that
marker and waits for/reuses the script instead of requesting the older release.
Other pages retain their existing release. Do not install both attribution versions.

Rollback: remove this homepage script and republish staging. The unchanged
immediate runtime resumes loading `6fa2423188ddccf9ef354132d3c1a303245e17a5`.

### Verification

`npm install && npm test` runs payload parity, consent, storage denial, dynamic
forms, validation, duplicate loading, and retry checks against the deployed baseline.
The baseline commit must be present in the local Git history.

For the real Webflow serializer / failure / retry / success UI integration test,
download the homepage's current forms chunk and pass its local path:

```sh
TDB_WEBFLOW_FORMS_FIXTURE=/path/to/webflow-forms-chunk.js npm test
```

The 11 October 2026 run used `webflow.achunk.dac51c455b7e76af.js` from the staging
site's Webflow CDN. It executed the actual forms module with jQuery 3.5.1 and
replaced only AJAX with a local test transport. No lead was sent.
