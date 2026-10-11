const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {execFileSync} = require('node:child_process');
const {JSDOM} = require('jsdom');
const jquery = require('jquery');
const baseline = execFileSync('git', ['show', '6fa2423188ddccf9ef354132d3c1a303245e17a5:dist/tdb-attribution.min.js'], {encoding:'utf8'});
const candidate = fs.readFileSync('dist/tdb-attribution.min.js','utf8');
const source = fs.readFileSync('src/tdb-attribution.js','utf8');
const form = id => `<div class="w-form"><form id="${id}" ms-code-submit-form data-name="Email Form" data-wf-page-id="home" data-wf-element-id="${id}"><input name="Name" required><input name="Last-Name" data-name="Last Name" required><input type="email" name="Email" required><input name="phone" type="tel" required><select name="Treatment-Of-Interest" data-name="Treatment Of Interest" required><option value="">Choose</option><option value="Signature Assessment">Assessment</option></select><input name="Marketing" type="checkbox" required><input name="Checkbox" type="checkbox" required><input type="submit" value="Request" data-wait="Please wait..."></form><div class="w-form-done" style="display:none">Success</div><div class="w-form-fail" style="display:none">Please retry</div></div>`;
const fields = f => Object.fromEntries([...f.elements].filter(e=>e.name.startsWith('tdb_')).map(e=>[e.name,e.value]));
const count = w => w.document.querySelectorAll('input[name^="tdb_"]').length;
const json = x => JSON.parse(JSON.stringify(x));
const consent = {action:'accept',categories:['strict','performance']};
function setup(code, options={}) {
  const dom = new JSDOM(`<html data-wf-site="test"><body>${form('email-form')}${form('vip-drawer-form')}</body></html>`,{url:options.url||'https://dentalbarns.webflow.io/',referrer:options.referrer,runScripts:'outside-only'});
  const w=dom.window;
  let now=1791715200000;
  const OriginalDate=w.Date;
  w.Date=class extends OriginalDate { constructor(...args){super(...(args.length?args:[now]));} static now(){return now;} };
  w.crypto.randomUUID=()=>'test-attribution-id';
  w.CookieScript={instance:{version:'test',currentState:()=>options.consent||{action:'reject',categories:['strict']}}};
  if(options.persistent) w.localStorage.setItem('tdb_attribution_v2',JSON.stringify(options.persistent));
  if(options.session) w.sessionStorage.setItem('tdb_attribution_session_v1',JSON.stringify(options.session));
  if(options.legacy) w.localStorage.setItem('tdb_attribution_v1',JSON.stringify(options.legacy));
  if(options.blockedStorage) for(const key of ['localStorage','sessionStorage']) Object.defineProperty(w,key,{get(){throw new w.DOMException('Storage denied','SecurityError');}});
  let observers=0; const OriginalObserver=w.MutationObserver;
  w.MutationObserver=class extends OriginalObserver { constructor(...args){super(...args);observers++;} };
  w.eval(code);w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  return {w,options,observers:()=>observers,advance:()=>{now+=1000;},close:()=>w.close()};
}
function submit(w,id='email-form') {
 const f=w.document.getElementById(id);let serialized;
 f.addEventListener('submit',e=>{serialized=fields(f);e.preventDefault();},{once:true});
 f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 return serialized;
}
function fill(f) {
 for(const e of f.elements) {
  if(e.type==='submit')continue;
  if(e.type==='checkbox')e.checked=true;
  else if(e.tagName==='SELECT')e.selectedIndex=1;
  else e.value=e.type==='email'?'test@example.invalid':e.name==='phone'?'07700900000':'TEST';
 }
}
const scenarios = [
 ['direct, essential-only',{}],
 ['undecided',{consent:{}}],
 ['paid Meta',{url:'https://dentalbarns.webflow.io/?utm_source=instagram&utm_medium=paid_social&utm_campaign=launch&utm_id=123456&utm_term=654321&utm_content=789012&fbclid=test&placement=stories',consent}],
 ['paid search IDs',{url:'https://dentalbarns.webflow.io/?utm_source=google&utm_medium=cpc&gclid=g&gbraid=gb&wbraid=wb&msclkid=m&ttclid=t&li_fat_id=l',consent}],
 ['internal referrer recovery',{url:'https://dentalbarns.webflow.io/first-visit',referrer:'https://dentalbarns.webflow.io/vip?utm_source=instagram&fbclid=ref',consent}],
 ['organic referral',{referrer:'https://www.google.com/',consent}],
 ['Safari denied storage',{consent,blockedStorage:true}],
 ['legacy storage',{consent,legacy:{attribution_id:'legacy-id',first_landing_path:'/vip',utm_source:'instagram',visit_number:2}}],
 ['return visit preserves first touch',{consent,persistent:{schema_version:2,attribution_id:'existing',first_touch:{path:'/vip',url:'https://dentalbarns.webflow.io/vip',at:'2026-10-10T10:00:00.000Z',method:'current_url',channel:'paid_social',platform:'instagram',fbclid:'original'},last_touch:{path:'/smile-gallery',channel:'direct'},visit_number:2,last_seen_at:1791715100000},session:{session_landing_path:'/vip',journey_paths:['/vip','/smile-gallery'],page_count:2,last_seen_at:1791715100000}}]
];
for(const [name,options] of scenarios) test(`same 61-field submission as deployed: ${name}`,()=>{
 const old=setup(baseline,options), next=setup(candidate,options);
 try {
  assert.equal(count(old.w),122);assert.equal(count(next.w),0);assert.equal(next.observers(),0);
  const a=submit(old.w), b=submit(next.w);
  assert.equal(Object.keys(b).length,61);assert.equal(b.tdb_attribution_version,'1.5.2');
  a.tdb_attribution_version=b.tdb_attribution_version;
  assert.deepEqual(b,a);
  assert.equal(next.w.document.querySelector('#vip-drawer-form').querySelectorAll('input[name^="tdb_"]').length,0);
  assert.equal(count(next.w),61);
  next.advance();const retry=submit(next.w);assert.equal(count(next.w),61);assert.notEqual(retry.tdb_submitted_at,b.tdb_submitted_at);
 } finally {old.close();next.close();}
});
test('refresh, status and consent changes never materialise untouched forms',()=>{
 const env=setup(candidate);const {w}=env;
 try{
  w.TDBAttribution.refresh();w.TDBAttribution.status();
  env.options.consent=consent;w.document.dispatchEvent(new w.Event('CookieScriptAcceptAll'));
  assert.equal(count(w),0);assert.ok(w.localStorage.getItem('tdb_attribution_v2'));
  env.options.consent={action:'reject',categories:['strict']};w.document.dispatchEvent(new w.Event('CookieScriptReject'));
  assert.equal(count(w),0);assert.equal(submit(w).tdb_attribution_storage_mode,'memory_only');
  w.TDBAttribution.refresh();assert.equal(count(w),61);
 }finally{env.close();}
});
test('dynamic forms, existing fields, unrelated forms, and duplicate loading',()=>{
 const env=setup(candidate);const {w}=env;
 try{
  w.eval(candidate);w.document.body.insertAdjacentHTML('beforeend',form('dynamic')+'<form id="unrelated"></form>');
  const f=w.document.getElementById('dynamic');
  f.insertAdjacentHTML('beforeend','<input type="hidden" name="tdb_channel" value="stale"><input type="hidden" name="application_field" value="keep">');
  assert.equal(submit(w,'dynamic').tdb_channel,'direct');assert.equal(count(w),61);
  assert.equal(f.querySelector('[name="application_field"]').value,'keep');
  submit(w,'unrelated');assert.equal(count(w),61);
 }finally{env.close();}
});
test('native invalid submission creates no fields; valid click and requestSubmit do',()=>{
 const env=setup(candidate);const {w}=env;
 try{
  const f=w.document.getElementById('email-form');let submissions=0;
  f.addEventListener('submit',e=>{e.preventDefault();submissions++;assert.equal(Object.keys(fields(f)).length,61);});
  f.requestSubmit();assert.equal(submissions,0);assert.equal(count(w),0);
  fill(f);f.querySelector('[type="submit"]').click();assert.equal(submissions,1);assert.equal(count(w),61);
  f.requestSubmit();assert.equal(submissions,2);assert.equal(count(w),61);
 }finally{env.close();}
});
test('source and minified distribution agree',()=>{
 const a=setup(source),b=setup(candidate);try{assert.deepEqual(submit(a.w),submit(b.w));}finally{a.close();b.close();}
});
// Execute the actual staging Webflow forms module with its normal jQuery
// serializer. Only the AJAX transport is replaced, so no lead is sent.
test('current Webflow serializer sees attribution before AJAX; failure and retry preserve UI', {skip:!process.env.TDB_WEBFLOW_FORMS_FIXTURE}, ()=>{
 const code=fs.readFileSync(process.env.TDB_WEBFLOW_FORMS_FIXTURE,'utf8');
 const env=setup(candidate,{consent});const {w}=env;const $=jquery(w);let api;
 try{
  const registry={};w.webpackChunk={push:entry=>Object.assign(registry,entry[1])};w.eval(code);
  const webflow={env:()=>false,define:(name,factory)=>{api=factory($,{debounce:fn=>fn});},location:()=>{throw Error('Unexpected navigation');}};
  const cache={3949:webflow};function req(id){if(cache[id])return cache[id];const m={exports:{}};registry[id](m,m.exports,req);return cache[id]=m.exports;}
  req(7527);api.ready();
  const requests=[];$.ajax=options=>{const d=$.Deferred();requests.push({options,deferred:d});return d;};
  const f=w.document.getElementById('email-form');fill(f);
  const button=f.querySelector('[type="submit"]');button.click();
  assert.equal(requests.length,1);assert.equal(button.disabled,true);assert.equal(button.value,'Please wait...');
  assert.equal(Object.keys(requests[0].options.data.fields).filter(k=>k.startsWith('tdb_')).length,61);
  assert.equal(requests[0].options.data.fields.tdb_attribution_storage_mode,'persistent');
  requests[0].deferred.reject();assert.equal(button.disabled,false);assert.equal(f.style.display,'');
  assert.notEqual(f.parentElement.querySelector('.w-form-fail').style.display,'none');
  env.advance();button.click();assert.equal(requests.length,2);assert.equal(count(w),61);
  assert.notEqual(requests[0].options.data.fields.tdb_submitted_at,requests[1].options.data.fields.tdb_submitted_at);
  requests[1].deferred.resolve({code:200});assert.equal(f.style.display,'none');
  assert.notEqual(f.parentElement.querySelector('.w-form-done').style.display,'none');
 }finally{env.close();}
});
