# TDB Webflow Attribution

Site-wide first-party attribution capture for The Dental Barns Webflow forms.

## Purpose

The script adds hidden attribution fields to every form matching:

```html
form[ms-code-submit-form]
```

That includes standard page forms and the shared drawer form.

## Captured fields

- `tdb_attribution_id`
- `tdb_first_landing_path`
- `tdb_first_touch_at`
- `tdb_initial_referrer`
- `tdb_utm_source`
- `tdb_utm_medium`
- `tdb_utm_campaign`
- `tdb_utm_content`
- `tdb_utm_term`
- `tdb_meta_campaign_id`
- `tdb_meta_adset_id`
- `tdb_meta_ad_id`
- `tdb_meta_placement`
- `tdb_fbclid`
- `tdb_visit_number`
- `tdb_submission_path`
- `tdb_submitted_at`

Full page paths are retained, for example:

```text
/treatments/composite-bonding
```

## Consent behaviour

Persistent attribution uses `localStorage` only after CookieScript reports consent for the `performance` category.

Before that consent is available, the script still populates the current form submission from in-memory page data but does not persist it across pages.

## Repository structure

```text
src/tdb-attribution.js   Readable source
 dist/tdb-attribution.js Production file loaded by Webflow
```

## Webflow installation

Use a commit-pinned jsDelivr URL so the live script cannot change unexpectedly:

```html
<script defer src="https://cdn.jsdelivr.net/gh/TheDentalBarns/tdb-webflow-attribution@COMMIT_SHA/dist/tdb-attribution.js"></script>
```

## Version

Initial production version: `1.0.0`
