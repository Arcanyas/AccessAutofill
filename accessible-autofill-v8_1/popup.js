const $ = id => document.getElementById(id);
const DEFINITIONS = [
  ['fullName','Full name'], ['firstName','First name'], ['lastName','Last name'],
  ['email','Email address'], ['phone','Phone number'], ['dateOfBirth','Date of birth (YYYY-MM-DD)'],
  ['addressLine1','Address line 1'], ['addressLine2','Address line 2'],
  ['city','Town / city'], ['county','County / region'], ['postcode','Postcode / ZIP'],
  ['country','Country'], ['occupation','Occupation'], ['organisation','Employer / organisation'],
  ['disabilityType','Disability type (optional)'], ['disabilityLevel','Self-described disability level (optional)'],
  ['accessibilityNeeds','Accessibility needs (optional)'],
  ['letterPreference','How would you like to receive letters?'],
  ['preferredContactMethod','Preferred contact method (e.g. Email, Phone, Post, SMS)'],
  ['existingSupport','Which support do you already use?'],
  ['nationalInsuranceNumber','National Insurance number (DEMO DATA ONLY)']
];
const FIELD_LABELS = Object.fromEntries(DEFINITIONS);
const SENSITIVE = new Set(['disabilityType','disabilityLevel','accessibilityNeeds','nationalInsuranceNumber']);
let profiles = {};
let activeId = null;
let activeTabId = null;
let lastScan = [];

function status(message) { $('status').textContent = message; }
function textEl(tag, content, className) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.textContent = content;
  return el;
}
function element(tag, attrs = {}) {
  const el = document.createElement(tag);
  Object.entries(attrs).forEach(([k,v]) => el[k] = v);
  return el;
}
function normalise(s) { return String(s).toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu,' '); }
function currentProfile() { return profiles[activeId] || {}; }
function ensureActiveProfile() {
  if (activeId && profiles[activeId]) return;
  activeId = crypto.randomUUID();
  profiles[activeId] = {profileName:'My profile'};
}

function buildEditor() {
  const root = $('profileFields');
  const name = element('input',{id:'profileName',type:'text',placeholder:'e.g. Demo user'});
  const nameLabel = element('label',{htmlFor:'profileName'});
  nameLabel.textContent = 'Profile name';
  root.append(nameLabel,name);
  for (const [key,label] of DEFINITIONS) {
    const wrapper = document.createElement('div');
    const lab = element('label',{htmlFor:`p_${key}`});
    lab.textContent = label;
    const inp = key === 'existingSupport' ? element('textarea',{id:`p_${key}`,rows:4}) : element('input',{id:`p_${key}`,type:key === 'dateOfBirth'?'date':key === 'email'?'email':key === 'phone'?'tel':'text'});
    if (key === 'preferredContactMethod') {
      // A free-text value matches the labels of the form's own dropdown options.
      // Suggestions help demo users without limiting the supported choices.
      const choices = element('datalist', {id: 'contact-method-options'});
      for (const method of ['Email', 'Phone', 'Telephone', 'Post', 'Letter', 'SMS', 'Text message']) {
        choices.append(new Option(method, method));
      }
      inp.setAttribute('list', choices.id);
      wrapper.append(choices);
    }
    if (SENSITIVE.has(key)) inp.autocomplete = 'off';
    wrapper.append(lab,inp);
    root.append(wrapper);
  }
}
function readEditor() {
  const profile = {profileName:$('profileName').value.trim()};
  for (const [key] of DEFINITIONS) profile[key] = $(`p_${key}`).value.trim();
  return profile;
}
function loadEditor(profile={}) {
  $('profileName').value = profile.profileName || '';
  for (const [key] of DEFINITIONS) $(`p_${key}`).value = profile[key] || '';
}
function refreshSelector() {
  const sel = $('profileSelect');
  sel.replaceChildren();
  for (const [id,p] of Object.entries(profiles)) sel.add(new Option(p.profileName || 'Unnamed profile',id));
  sel.value = activeId;
}
async function persist() {
  await chrome.storage.local.set({profiles,activeProfileId:activeId});
}
async function initialise() {
  buildEditor();
  const data = await chrome.storage.local.get(['profiles','activeProfileId','profile']);
  profiles = data.profiles || {};
  activeId = data.activeProfileId || null;
  if (!Object.keys(profiles).length && data.profile) {
    activeId = crypto.randomUUID();
    profiles[activeId] = {profileName:'Imported profile',fullName:data.profile.name || '',email:data.profile.email || ''};
  }
  if (!activeId || !profiles[activeId]) activeId = Object.keys(profiles)[0] || null;
  ensureActiveProfile();
  refreshSelector();
  loadEditor(currentProfile());
  await persist();
}
$('profileSelect').addEventListener('change', async e => {
  activeId = e.target.value;
  loadEditor(currentProfile());
  $('suggestions').replaceChildren();
  await persist();
  status('Profile switched. Unsaved edits to the previous profile were not saved.');
});
$('newProfile').addEventListener('click', async () => {
  activeId = crypto.randomUUID();
  profiles[activeId] = {profileName:'New profile'};
  refreshSelector();
  loadEditor(currentProfile());
  $('suggestions').replaceChildren();
  await persist();
  $('profileName').focus();
  status('New profile created. Enter details, then save.');
});
$('deleteProfile').addEventListener('click', async () => {
  if (!confirm(`Delete the saved profile "${currentProfile().profileName || 'Unnamed'}"?`)) return;
  delete profiles[activeId];
  activeId = Object.keys(profiles)[0] || null;
  ensureActiveProfile();
  await persist();
  refreshSelector();
  loadEditor(currentProfile());
  $('suggestions').replaceChildren();
  status('Profile deleted.');
});
$('saveProfile').addEventListener('click', async () => {
  const profile = readEditor();
  if (!profile.profileName) return status('Please give this profile a name.');
  profiles[activeId] = profile;
  await persist();
  refreshSelector();
  status('Profile saved.');
});

async function runInPage(action, payload = null) {
  const result = await chrome.scripting.executeScript({
    target:{tabId:activeTabId},
    func:(act,data) => {
      const api = window.__accessibleAutofillV3;
      if (!api) throw new Error('Page helper unavailable; rescan.');
      return act === 'scan' ? api.scan() : api.apply(data);
    },
    args:[action,payload]
  });
  return result[0]?.result;
}
function semanticKey(item) {
  // Deterministic, narrow aliases. The AI still handles unusual descriptions.
  const text = `${item.question || ''} ${item.autocomplete || ''}`.toLowerCase();
  if (/(current|residential|home|street|mailing|postal)\s+address|address\s*(line\s*)?1|street\s*address/.test(text) &&
      !/address\s*(line\s*)?2|apt|suite|unit/.test(text)) return 'addressLine1';
  if (/(date\s*of\s*birth|birth\s*date|\bdob\b|birthday)/.test(text)) return 'dateOfBirth';
  if (/\b(city|town|locality)\b/.test(text)) return 'city';
  if (/\b(state|province|county|region)\b/.test(text)) return 'county';
  if (/\b(zip|postcode|postal code)\b/.test(text)) return 'postcode';
  if (/\b(country)\b/.test(text)) return 'country';
  return 'unknown';
}
function dobChoices(dateOfBirth, item) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth || '');
  if (!m || !item.dobPart) return [];
  const [, year, month, day] = m;
  const target = item.dobPart === 'year' ? Number(year) :
    item.dobPart === 'month' ? Number(month) : Number(day);
  const names = ['january','february','march','april','may','june','july',
    'august','september','october','november','december'];
  return (item.options || []).filter(o => {
    const label = String(o.label).trim().toLowerCase();
    const val = String(o.value).trim().toLowerCase();
    const numeric = x => /^\d{1,4}$/.test(x) ? Number(x) : NaN;
    if (numeric(label) === target || numeric(val) === target) return true;
    if (item.dobPart === 'month') {
      const index = names.findIndex(n => label === n || label === n.slice(0,3) ||
        label.startsWith(n.slice(0,3) + ' '));
      return index + 1 === target;
    }
    return false;
  });
}
function findMatchingSelect(item, key, saved) {
  if (!saved) return [];
  if (key === 'dateOfBirth' && item.dobPart) return dobChoices(saved,item);
  const wanted = normalise(saved);
  return (item.options || []).filter(c =>
    normalise(c.label) === wanted || normalise(c.value) === wanted);
}
function addAnswerCard(item, key, profile, replaceNode = null) {
  const root = $('suggestions');
  const card = textEl('article','', 'field');
  const title = textEl('p',item.question,'question');
  const source = textEl('p',key !== 'unknown' ? `Profile match: ${FIELD_LABELS[key]}` : 'No saved match found', 'source');
  card.append(title,source);
  if (item.id) card.dataset.fieldId = item.id;
  card.dataset.profileKey = key;
  if (replaceNode) replaceNode.replaceWith(card);
  else root.append(card);

  const mark = message => {
    let out = card.querySelector('[data-result]');
    if (!out) {out = textEl('p',''); out.dataset.result='true'; card.append(out);}
    out.textContent = message;
  };
  async function apply(payload) {
    const result = await runInPage('apply',payload);
    mark(result?.message || 'Unable to apply');
    if (result?.ok) status('Answer applied. Review it on the webpage.');
    return result;
  }

  // Checkboxes are *never* chosen by Gemini. Only this button can tick them.
  if (item.kind === 'checkbox') {
    card.append(textEl('p',`Checkbox: ${item.label || item.question}`,'instructions'));
    const button = element('button',{type:'button',textContent:item.checked?'Already checked':'I want this box ticked'});
    button.className='secondary';
    button.disabled=!!item.checked;
    button.addEventListener('click',async()=>{
      const outcome = await runInPage('apply',{id:item.id,action:'check'});
      mark(outcome?.message || 'Unable to select checkbox');
      if (outcome?.ok) button.disabled=true;
    });
    card.append(button);
    return;
  }

  if (item.kind === 'radio' || item.kind === 'select') {
    const label = textEl('label','Choose an answer');
    const selection = element('select');
    label.append(selection);
    selection.add(new Option('Choose an option',''));
    const choices = item.kind === 'radio' ?
      item.controls.map(x=>({value:x.id,label:x.label})) : item.options;
    for (const option of choices) selection.add(new Option(option.label || '(unlabelled)',option.value));
    const saved = profile[key];
    const matching = item.kind === 'select'
      ? findMatchingSelect(item, key, saved)
      : choices.filter(c => saved && normalise(c.label) === normalise(saved));
    if (matching.length === 1) selection.value = matching[0].value;
    card.append(label);
    if (key === 'dateOfBirth' && item.kind === 'select' && !item.dobPart) {
      card.append(textEl('p','Could not tell which birth-date component this dropdown controls. Choose manually.','instructions'));
    } else if (saved && matching.length === 0) {
      card.append(textEl('p',`Saved value "${saved}" does not exactly match an option. Please choose manually.`,'instructions'));
    }
    const button = element('button',{type:'button',textContent:'Select this option'});
    button.addEventListener('click',async()=>{
      if (!selection.value) return mark('Choose an option first.');
      const id = item.kind === 'radio' ? selection.value : item.id;
      const action = item.kind === 'radio' ? 'radio' : 'select';
      const result = await apply({id, action, value:selection.value});
      if (result?.ok && item.kind === 'select' && key === 'county') {
        mark('State/region selected. Checking for updated city options…');
        await refreshDependentCities();
      }
    });
    card.append(button);
    return;
  }

  // For missing profile information, ask a simpler question and allow optional saving.
  const simple = {
    fullName:'What is your full name?', firstName:'What is your first name?',lastName:'What is your surname?',
    email:'What email address should we use?',phone:'What phone number should we use?',
    dateOfBirth:'When were you born?',addressLine1:'What is the first line of your address?',
    addressLine2:'Is there a second address line?',city:'What town or city do you live in?',
    county:'What county or region do you live in?',postcode:'What is your postcode?',
    country:'Which country do you live in?',occupation:'What is your job or occupation?',
    organisation:'What organisation do you work for?',disabilityType:'How do you describe your disability, if you want to share?',
    disabilityLevel:'How do you describe your disability level, if you want to share?',
    accessibilityNeeds:'What adjustments or support would help you?'
  };
  const question = textEl('label',profile[key] ? 'Suggested answer (you can edit it)' : (simple[key] || 'What would you like to enter?'));
  const input = element(item.kind==='date'?'input':'textarea');
  input.id = `answer_${item.id}`;
  input.type = item.kind==='date'?'date':'text';
  input.rows = 2;
  input.value = profile[key] || '';
  if (item.kind==='date' && !/^\d{4}-\d{2}-\d{2}$/.test(input.value)) input.value='';
  question.htmlFor = input.id;
  const saveLabel = element('label',{className:'rowcheck'});
  const saveCheck = element('input',{type:'checkbox'});
  saveCheck.checked=false;
  saveLabel.append(saveCheck,document.createTextNode('Save this answer to the active profile for later'));
  card.append(question,input);
  if (key !== 'unknown') card.append(saveLabel);
  const button = element('button',{type:'button',textContent:'Fill this field'});
  button.addEventListener('click',async()=>{
    const value=input.value.trim();
    if (!value) return mark('Please enter an answer first, or leave this field unanswered.');
    const result = await runInPage('apply',{id:item.id,action:'text',value});
    mark(result?.message || 'Unable to apply');
    if (result?.ok && saveCheck.checked && key !== 'unknown') {
      profiles[activeId][key]=value;
      await persist();
      loadEditor(currentProfile());
      mark('Filled and saved to this profile.');
    }
  });
  card.append(button);
}


// After choosing a state/region, some forms rebuild their city dropdown
// asynchronously. Poll briefly and replace only city cards, preserving all
// the other suggestions and answers already entered in the popup.
function citySignature(item) {
  return JSON.stringify((item.options || []).map(option => [option.value, option.label]));
}
function isCitySelect(item) {
  if (item.kind !== 'select') return false;
  if (semanticKey(item) === 'city') return true;
  // Recognise a city field already classified by Gemini on the previous scan.
  const old = lastScan.find(oldItem => oldItem.id === item.id);
  if (!old) return false;
  const oldCard = [...document.querySelectorAll('#suggestions .field')]
    .find(card => card.dataset.fieldId === old.id);
  return oldCard?.dataset.profileKey === 'city';
}
async function refreshDependentCities() {
  const previousCities = lastScan.filter(isCitySelect);
  const oldSignatures = new Map(previousCities.map(item => [item.id, citySignature(item)]));
  let updated = [];
  let changed = false;
  // React/Angular forms sometimes populate the next select after a short delay.
  for (let attempt = 0; attempt < 12; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 250));
    updated = await runInPage('scan');
    const cities = updated.filter(isCitySelect);
    changed = cities.some(item => !oldSignatures.has(item.id) ||
      oldSignatures.get(item.id) !== citySignature(item));
    if (changed) break;
  }
  if (!updated.length) {
    status('State selected, but the form no longer exposes visible fields.');
    return;
  }
  // Refresh our control references even when the page re-rendered without
  // changing the visible option labels.
  const previous = lastScan;
  lastScan = updated;
  const cities = updated.filter(item => {
    if (semanticKey(item) === 'city') return true;
    const old = previous.find(x => x.id === item.id);
    return !!old && previousCities.some(x => x.id === old.id);
  });
  let refreshed = 0;
  for (const city of cities) {
    const existing = [...document.querySelectorAll('#suggestions .field')]
      .find(card => card.dataset.fieldId === city.id);
    // Never replace a card that has a user-entered value unless its options
    // changed; a changed set of choices must be reviewed again.
    if (existing && !changed) continue;
    addAnswerCard(city, 'city', currentProfile(), existing || null);
    refreshed++;
  }
  status(changed
    ? `State selected. ${refreshed} city dropdown${refreshed === 1 ? '' : 's'} refreshed; review the city suggestion.`
    : 'State selected. City options have not changed yet; you can continue or scan again later.');
}

$('scan').addEventListener('click',async()=>{
  const button=$('scan');
  button.disabled=true;
  $('suggestions').replaceChildren();
  try {
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    if (!tab?.id || !/^https?:/.test(tab.url || '')) throw new Error('Open an ordinary http(s) webpage with a form.');
    activeTabId=tab.id;
    await chrome.scripting.executeScript({target:{tabId:activeTabId},files:['content.js']});
    lastScan = await runInPage('scan');
    if (!lastScan.length) {status('No supported visible fields found.');return;}
    const profile = currentProfile();
    status(`Found ${lastScan.length} fields. Preparing review suggestions…`);
    for (const [i,item] of lastScan.entries()) {
      let key = semanticKey(item);
      if (item.kind !== 'checkbox' && key === 'unknown') {
        try {
          const response=await fetch('http://127.0.0.1:3000/match',{
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({question:item.question,inputType:item.inputType||item.kind,autocomplete:item.autocomplete||''})
          });
          if (!response.ok) throw new Error(`Backend HTTP ${response.status}`);
          const result=await response.json();
          if (FIELD_LABELS[result.profileKey]) key=result.profileKey;
        } catch(err) {console.warn('Question matching failed',err);}
      }
      addAnswerCard(item,key,profile);
      status(`Prepared ${i+1} of ${lastScan.length} fields…`);
    }
    status(`Ready: ${lastScan.length} fields. Review each suggestion; nothing has been submitted.`);
  } catch(err) {
    status(`Could not scan: ${err.message}`);
  } finally { button.disabled=false; }
});
initialise().catch(err=>status(`Start-up problem: ${err.message}`));
