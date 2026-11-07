// Injected on demand; nothing is sent to the network by this script.
(() => {
  if (window.__accessibleAutofillV3) return;
  const controls = new Map();
  let nextId = 1;
  const ids = new WeakMap();

  function idFor(element) {
    if (!ids.has(element)) ids.set(element, `field-${nextId++}`);
    const id = ids.get(element);
    controls.set(id, element);
    return id;
  }
  function visible(el) {
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && !!el.getClientRects().length;
  }
  function labelFor(el) {
    const labels = el.labels ? [...el.labels].map(x => x.textContent.trim()).join(' ') : '';
    const labelledBy = (el.getAttribute('aria-labelledby') || '').split(/\s+/)
      .filter(Boolean).map(id => document.getElementById(id)?.textContent?.trim() || '').join(' ');
    return [labels, labelledBy, el.getAttribute('aria-label'), el.getAttribute('placeholder')]
      .filter(Boolean).join(' ').trim();
  }
  function questionFor(el) {
    const label = labelFor(el);
    const group = el.closest('fieldset, [role="group"], [role="radiogroup"], [role="listitem"], .form-group');
    const legend = group?.querySelector('legend, [role="heading"]')?.textContent?.trim() || '';
    return [legend, label].filter(Boolean).join(' — ').slice(0, 400) ||
      el.getAttribute('name') || el.id || 'Unlabelled form field';
  }
  function contextFor(el) {
    // Keep the actual field's label first; containers often contain multiple questions.
    const tokens = [labelFor(el), el.name || '', el.id || '', el.getAttribute('autocomplete') || ''];
    const group = el.closest('fieldset, [role="group"], [role="listitem"], .form-group, .form-field');
    const legend = group?.querySelector('legend, [role="heading"]')?.textContent?.trim() || '';
    return {tokens:tokens.filter(Boolean).join(' '), legend};
  }
  function dobPartFor(el) {
    if (!(el instanceof HTMLSelectElement)) return '';
    const {tokens, legend} = contextFor(el);
    const text = `${tokens} ${legend}`.toLowerCase();
    if (!/(date\s*of\s*birth|birth\s*date|dob|birthday|birth)/i.test(text)) return '';
    const local = tokens.toLowerCase();
    if (/\b(day|dd|birth-day|birth_day)\b/.test(local)) return 'day';
    if (/\b(month|mm|birth-month|birth_month)\b/.test(local)) return 'month';
    if (/\b(year|yyyy|birth-year|birth_year)\b/.test(local)) return 'year';
    const options = [...el.options].map(o => o.textContent.trim().toLowerCase()).filter(Boolean);
    if (options.some(o=>/^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?)$/.test(o))) return 'month';
    const numerics = options.map(o=>Number(o)).filter(n=>Number.isInteger(n));
    if (numerics.length >= 10 && numerics.every(n=>n>=1900 && n<=2100)) return 'year';
    // If a DOB container has exactly three selects, commonly ordered day/month/year,
    // only infer the remaining position when one component can be established.
    const container = el.closest('fieldset, [role="group"], [role="listitem"], .form-group');
    const siblings = container ? [...container.querySelectorAll('select')].filter(visible) : [];
    if (siblings.length === 3) {
      const index = siblings.indexOf(el);
      const parts = siblings.map(node => {
        const hint = [labelFor(node), node.name, node.id].join(' ').toLowerCase();
        if (/\b(day|dd)\b/.test(hint)) return 'day';
        if (/\b(month|mm)\b/.test(hint)) return 'month';
        if (/\b(year|yyyy)\b/.test(hint)) return 'year';
        const values = [...node.options].map(o=>Number(o.textContent.trim()))
          .filter(n=>Number.isInteger(n));
        if (values.length >= 10 && values.every(n=>n>=1900 && n<=2100)) return 'year';
        if ([...node.options].some(o=>/^jan(?:uary)?$/i.test(o.textContent.trim()))) return 'month';
        return '';
      });
      if (parts.filter(Boolean).length >= 2 && index !== -1) {
        const remaining = ['day','month','year'].filter(part=>!parts.includes(part));
        if (remaining.length === 1) return remaining[0];
      }
    }
    // Do not guess numeric day/month from position alone.
    return '';
  }
  function normScan(s){return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}
  function optionLabel(el) {
    const label = labelFor(el);
    return label || el.closest('label')?.textContent?.trim() || el.value || el.textContent?.trim() || '';
  }
  // Google Forms question blocks contain the accessible question heading and
  // the associated controls. Scan at block level to avoid treating choice
  // labels, help text, and repeated field names as separate questions.
  function scanGoogleForms() {
    const blocks = [...document.querySelectorAll('[role="listitem"]')]
      .filter(visible);
    const out = [];
    for (const block of blocks) {
      const heading = block.querySelector('[role="heading"], legend, [aria-level]');
      // Some Google Forms versions put the heading text outside role=heading.
      const question = (heading?.textContent || block.querySelector('[data-item-id]')?.textContent || '')
        .replace(/\s+/g, ' ').trim().slice(0, 400);
      const eligible = [...block.querySelectorAll('input, textarea, select, [role="radio"], [role="checkbox"]')]
        .filter(el => visible(el) && !el.disabled && !el.readOnly && el.getAttribute('aria-disabled') !== 'true'
          && !(el instanceof HTMLInputElement && ['hidden','password','file','submit','reset','button','image'].includes(el.type)));
      if (!eligible.length) continue;
      const title = question || questionFor(eligible[0]);
      const radios = eligible.filter(el => el.matches('input[type="radio"], [role="radio"]'));
      if (radios.length) {
        out.push({kind:'radio', question:title, controls:radios.map(el=>({id:idFor(el),label:optionLabel(el)})), checked:radios.some(el=>el.matches('input')?el.checked:el.getAttribute('aria-checked')==='true')});
      }
      const checkboxes = eligible.filter(el => el.matches('input[type="checkbox"], [role="checkbox"]'));
      for (const el of checkboxes) {
        // One checkbox is one deliberate Yes/No choice; never batch tick.
        const option = optionLabel(el);
        out.push({kind:'checkbox', question: option && option !== title ? `${title} — ${option}` : title,
          id:idFor(el), label:option, groupQuestion:title,
          checked:el.matches('input')?el.checked:el.getAttribute('aria-checked')==='true'});
      }
      const others = eligible.filter(el => !el.matches('input[type="radio"], [role="radio"], input[type="checkbox"], [role="checkbox"]'));
      for (const el of others) {
        if (el instanceof HTMLSelectElement) {
          out.push({kind:'select', question:title, id:idFor(el),
            options:[...el.options].filter(x=>!x.disabled && x.value!=='').map(o=>({value:o.value,label:o.textContent.trim()})),
            hasValue:el.value!=='' && el.selectedIndex>0,
            dobPart:dobPartFor(el),autocomplete:el.getAttribute('autocomplete')||''});
          continue;
        }
        if (el instanceof HTMLInputElement && el.type === 'date') {
          out.push({kind:'date',question:title,id:idFor(el),inputType:'date',hasValue:!!el.value});
          continue;
        }
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          // Explicitly retain the label as context when a Google Forms block
          // contains more than one text field.
          const label=labelFor(el);
          out.push({kind:'text',id:idFor(el),question:label && normScan(label)!==normScan(title) ? `${title} — ${label}`:title,
            inputType:el.type||'text',longAnswer:el instanceof HTMLTextAreaElement,autocomplete:el.getAttribute('autocomplete')||'',hasValue:!!el.value});
        }
      }
    }
    return out;
  }
  function scan() {
    controls.clear();
    if (location.hostname === "docs.google.com" && location.pathname.includes("/forms/")) {
      const googleItems = scanGoogleForms();
      if (googleItems.length) return googleItems;
    }
    const nodes = [...document.querySelectorAll('input, textarea, select, [role="radio"], [role="checkbox"]')];
    const candidates = nodes.filter(el => {
      if (!visible(el) || el.disabled || el.readOnly || el.getAttribute('aria-disabled') === 'true') return false;
      if (el instanceof HTMLInputElement && ['hidden','password','file','submit','reset','button','image'].includes(el.type)) return false;
      return true;
    });
    const groups = [];
    const seenRadio = new Set();

    for (const el of candidates) {
      let kind = 'text';
      if (el.matches('select')) kind = 'select';
      else if (el.matches('input[type="date"]')) kind = 'date';
      else if (el.matches('input[type="radio"], [role="radio"]')) kind = 'radio';
      else if (el.matches('input[type="checkbox"], [role="checkbox"]')) kind = 'checkbox';

      if (kind === 'radio') {
        const scope = el.closest('fieldset, [role="radiogroup"], [role="listitem"], [role="group"]') || el.form || document.body;
        const name = el.getAttribute('name');
        const radios = candidates.filter(node => {
          if (!(node.matches('input[type="radio"], [role="radio"]'))) return false;
          if (name && node.getAttribute('name') === name) return true;
          return !name && (node.closest('fieldset, [role="radiogroup"], [role="listitem"], [role="group"]') || node.form || document.body) === scope;
        });
        const key = radios.map(idFor).join('|');
        if (seenRadio.has(key)) continue;
        seenRadio.add(key);
        groups.push({kind, question: questionFor(el), controls: radios.map(r => ({id: idFor(r), label: optionLabel(r)})), checked:radios.some(r=>r.matches('input')?r.checked:r.getAttribute('aria-checked')==='true')});
        continue;
      }
      if (kind === 'select') {
        groups.push({ kind, question: questionFor(el), id: idFor(el),
          options: [...el.options].filter(x => !x.disabled && x.value !== '').map(o => ({value:o.value, label:o.textContent.trim()})),
          hasValue: el.value !== '' && el.selectedIndex > 0, dobPart: dobPartFor(el),
          autocomplete:el.getAttribute('autocomplete') || '' });
        continue;
      }
      if (kind === 'checkbox') {
        groups.push({kind, question: questionFor(el), id:idFor(el), label:optionLabel(el), groupQuestion:questionFor(el),
          checked: el.matches('input') ? el.checked : el.getAttribute('aria-checked') === 'true'});
        continue;
      }
      groups.push({ kind, id:idFor(el), question:questionFor(el),
        inputType: el.type || 'text', longAnswer:el instanceof HTMLTextAreaElement, autocomplete:el.getAttribute('autocomplete') || '',
        hasValue: !!el.value });
    }
    return groups;
  }
  function apply({id, value, action}) {
    const el = controls.get(id);
    if (!el || !el.isConnected || el.disabled || el.readOnly || el.getAttribute('aria-disabled') === 'true') {
      return {ok:false, message:'The field changed or is unavailable. Scan again.'};
    }
    if (action === 'check') {
      if (!el.matches('input[type="checkbox"], [role="checkbox"]')) return {ok:false, message:'Not a checkbox'};
      const checked = el.matches('input') ? el.checked : el.getAttribute('aria-checked') === 'true';
      if (!checked) el.click();
      const nowChecked = el.matches('input') ? el.checked : el.getAttribute('aria-checked') === 'true';
      return {ok:nowChecked, message:nowChecked ? 'Checkbox selected' : 'Could not select checkbox'};
    }
    if (action === 'radio') {
      if (!el.matches('input[type="radio"], [role="radio"]')) return {ok:false, message:'Not a radio option'};
      el.click();
      const checked = el.matches('input') ? el.checked : el.getAttribute('aria-checked') === 'true';
      return {ok:checked, message:checked ? 'Option selected' : 'Could not select option'};
    }
    if (action === 'select') {
      if (!(el instanceof HTMLSelectElement)) return {ok:false, message:'Not a select field'};
      if (![...el.options].some(o => o.value === value && !o.disabled)) return {ok:false, message:'Option no longer exists. Scan again.'};
      if (el.value === value) return {ok:true, message:'Already selected'};
      el.value = value;
      el.dispatchEvent(new Event('input', {bubbles:true}));
      el.dispatchEvent(new Event('change', {bubbles:true}));
      return {ok:el.value === value, message:'Option applied'};
    }
    if (action === 'text') {
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return {ok:false, message:'Not a text field'};
      if (el.value) return {ok:false, message:'Field already contains information'};
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(el, String(value));
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
      return {ok:el.value === String(value), message:'Text entered'};
    }
    return {ok:false, message:'Unsupported action'};
  }
  function meta() {
    const isGoogle = location.hostname === 'docs.google.com' && location.pathname.includes('/forms/');
    const title = (isGoogle ? document.querySelector('[role="heading"][aria-level="1"], h1') : document.querySelector('h1'))?.textContent?.trim()
      || document.title || 'Untitled form';
    const description = isGoogle
      ? [...document.querySelectorAll('[role="heading"][aria-level="1"]')].flatMap(e => e.parentElement ? [e.parentElement.nextElementSibling?.textContent || ''] : []).join(' ').slice(0,700)
      : (document.querySelector('form [class*="description"], main p, form p')?.textContent || '');
    const formButtons = [...document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]')]
      .filter(visible).map(e => (e.textContent || e.getAttribute('aria-label') || e.value || '').trim());
    const hasNext = formButtons.some(t => /^(next|continue|next page)$/i.test(t));
    const progressText = [...document.querySelectorAll('[role="progressbar"], [aria-label*="page" i], [aria-label*="section" i]')]
      .map(el => el.getAttribute('aria-label') || el.textContent || '').join(' ').slice(0,300);
    const match = progressText.match(/(?:page|section)\s*(\d+)\s*(?:of|\/)\s*(\d+)/i);
    return {title:title.slice(0,180),description:description.trim().slice(0,700),
      hasNext, pageNumber:match?Number(match[1]):null, pageCount:match?Number(match[2]):null};
  }
  function navigate({action}={}){
    if(!['next','submit'].includes(action))return {ok:false,message:'Unsupported navigation action'};
    const candidates=[...document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]')]
      .filter(el=>visible(el)&&!el.disabled&&el.getAttribute('aria-disabled')!=='true');
    const pattern=action==='next'?/^(next|continue|next page)$/i:/^(submit|send|submit form)$/i;
    const matches=candidates.filter(el=>pattern.test((el.textContent||el.getAttribute('aria-label')||el.value||'').trim()));
    if(matches.length!==1)return {ok:false,message:matches.length?'Several matching buttons found':'No visible '+action+' button found'};
    matches[0].click();
    return {ok:true,message:action+' clicked'};
  }
  window.__accessibleAutofillV3 = {scan, apply, meta, navigate};
})();
