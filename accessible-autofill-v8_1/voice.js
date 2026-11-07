'use strict';
const $ = id => document.getElementById(id);
const KEYS = ['fullName','firstName','lastName','email','phone','dateOfBirth','addressLine1','addressLine2','city','county','postcode','country','occupation','organisation','disabilityType','disabilityLevel','accessibilityNeeds','letterPreference','existingSupport','nationalInsuranceNumber','preferredContactMethod'];
const SENSITIVE = new Set(['disabilityType','disabilityLevel','accessibilityNeeds','existingSupport','nationalInsuranceNumber']);
const RECOGNITION = window.SpeechRecognition || window.webkitSpeechRecognition;
const safe = s => String(s ?? '').trim();
const norm = s => safe(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
let profiles={},activeId=null,tabId=null,questions=[],plan=[],meta={},cursor=0,stage='idle',current=null,pending=null;
let lastSpoken='',listening=null,stopped=false,busy=false,completed=0,dictation=[],dictationRunning=false;
let session=0;
const profile=()=>profiles[activeId]||{};
const setStatus=s=>$('status').textContent=s;
const setPrompt=s=>$('prompt').textContent=s;
function stopListening(){const r=listening;listening=null;if(r){try{r.abort()}catch{}}}
function stopSpeaking(){window.speechSynthesis?.cancel()}
// Short, distinct confirmation tone after an actual successful field change.
let audioContext=null;
function armAudio(){
  try{
    audioContext ||= new (window.AudioContext||window.webkitAudioContext)();
    if(audioContext.state==='suspended')audioContext.resume().catch(()=>{});
  }catch(err){console.debug('Audio unavailable:',err.message)}
}
// Unlock audio on a real user gesture. Required by Chrome's autoplay policy.
document.addEventListener('pointerdown',armAudio,{once:true});
document.addEventListener('keydown',armAudio,{once:true});
function successBeep(){
  try {
    audioContext ||= new (window.AudioContext||window.webkitAudioContext)();
    if(audioContext.state==='suspended')audioContext.resume().catch(()=>{});
    const t=audioContext.currentTime,osc=audioContext.createOscillator(),gain=audioContext.createGain();
    osc.type='sine';osc.frequency.setValueAtTime(660,t);
    osc.frequency.setValueAtTime(880,t+0.09);
    gain.gain.setValueAtTime(0.0001,t);
    gain.gain.exponentialRampToValueAtTime(0.12,t+0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001,t+0.20);
    osc.connect(gain);gain.connect(audioContext.destination);osc.start(t);osc.stop(t+0.21);
  }catch(err){console.debug('Confirmation tone unavailable:',err.message)}
}

// Brief single ding reserved for a confirmed completed submission.
function submissionDing(){
  try{
    audioContext ||= new (window.AudioContext||window.webkitAudioContext)();
    if(audioContext.state==='suspended')audioContext.resume().catch(()=>{});
    const t=audioContext.currentTime;
    const osc=audioContext.createOscillator(),gain=audioContext.createGain();
    osc.type='sine';osc.frequency.setValueAtTime(1046.5,t);
    gain.gain.setValueAtTime(0.0001,t);
    gain.gain.exponentialRampToValueAtTime(0.16,t+0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001,t+0.25);
    osc.connect(gain);gain.connect(audioContext.destination);
    osc.start(t);osc.stop(t+0.26);
  }catch(err){console.debug('Submission ding unavailable:',err.message)}
}

// Look for a real confirmation screen; merely clicking Submit is insufficient.
async function hasSubmissionConfirmation(){
  const result=await chrome.scripting.executeScript({
    target:{tabId},
    func:()=>{
      const page=(document.body?.innerText||'').slice(0,12000);
      const confirmation=/\b(your response has been recorded|your response was recorded|response has been submitted|form submitted successfully|thank you for (?:submitting|your submission)|your response has been received|your submission has been received)\b/i.test(page);
      // Google Forms' confirmation page generally has no visible Submit button.
      const submitPresent=[...document.querySelectorAll('button,[role="button"],input[type="submit"]')]
        .some(el=>/^(submit|submit form|send)$/i.test((el.textContent||el.getAttribute('aria-label')||el.value||'').trim()));
      return confirmation&&!submitPresent;
    }
  });
  return result[0]?.result===true;
}

function endDictationMode(){dictationRunning=false;stopListening();$('endDictation').hidden=true;}
function speak(message,autoListen=false){
  stopListening();stopSpeaking();lastSpoken=message;setPrompt(message);
  const go=()=>{if(autoListen&&!stopped)listen(true)};
  if(!('speechSynthesis'in window)){go();return}
  const u=new SpeechSynthesisUtterance(message);u.lang='en-GB';u.rate=1.04;u.onend=go;
  u.onerror=()=>setStatus('Voice playback unavailable. Read the text or use the buttons.');
  speechSynthesis.speak(u);
}
function handleDictation(text){
  const cleaned=safe(text);
  if(!cleaned)return;
  const trigger=/(?:^|\s)(?:end answer|end dictation|finished dictating|stop dictation)(?:[.!?])?\s*$/i;
  const shortEnd=/^end[.!?]?$/i.test(cleaned);
  const ended=shortEnd||trigger.test(cleaned);
  const part=shortEnd?'':cleaned.replace(trigger,'').trim();
  if(part)dictation.push(part);
  $('answer').value=dictation.join(' ').trim();
  if(ended){finishDictation();return}
  setStatus('Dictating… Say “end answer” to finish, or press End long answer.');
}
function finishDictation(){
  endDictationMode();
  if(stage!=='answer')return;
  if(!$('answer').value.trim()){setStatus('No words recorded. Speak again or type your answer.');return}
  answerFromInput();
}
function listen(automatic=false){
  if(!RECOGNITION){setStatus('Speech recognition unavailable. Use the answer box or buttons.');return}
  stopListening();
  const r=new RECOGNITION();listening=r;r.lang='en-GB';r.continuous=false;r.interimResults=false;r.maxAlternatives=1;
  const wasDictation=dictationRunning&&stage==='answer';
  let hadResult=false,hadError=false;
  r.onresult=e=>{
    if(listening!==r)return;
    hadResult=true;
    const text=safe(e.results?.[0]?.[0]?.transcript);
    $('transcript').textContent=text||'Nothing heard';
    if(wasDictation&&dictationRunning){handleDictation(text)}else{handleSpeech(text)}
  };
  r.onerror=e=>{
    if(listening!==r)return;
    hadError=true;
    if(wasDictation&&e.error==='no-speech'){setStatus('No speech heard. Press Speak my answer to continue or End long answer to finish.');return}
    if(wasDictation)dictationRunning=false;
    setStatus(`Microphone: ${e.error}. Press Speak my answer, or type an answer.`);
  };
  r.onend=()=>{
    if(listening!==r)return;
    listening=null;
    if(wasDictation&&dictationRunning&&!stopped&&!busy&&!hadError){
      // Browser speech recognition ends on a pause. Restart in the same dictation session.
      // Stop via "end answer" or the button; no fixed-length recording is assumed.
      listen(true);
    }else if(!hadResult&&!hadError&&automatic&&!wasDictation){
      setStatus('I did not hear an answer. Press Speak my answer or use a button.');
    }
  };
  try{r.start();setStatus(wasDictation?'Dictating… Say “end answer” when finished.':'Listening for your answer…')}
  catch(err){listening=null;if(wasDictation)dictationRunning=false;setStatus(`Could not start microphone: ${err.message}`)}
}
async function readProfiles(){
  const data=await chrome.storage.local.get(['profiles','activeProfileId']);
  profiles=data.profiles||{};activeId=data.activeProfileId;
  if(!profiles[activeId])activeId=Object.keys(profiles)[0]||null;
  $('profile').replaceChildren();
  for(const [id,p] of Object.entries(profiles))$('profile').add(new Option(p.profileName||'Unnamed profile',id));
  if(activeId)$('profile').value=activeId;
  else setStatus('Create a profile first using Manage saved profiles.');
}
async function inPage(action,data=null){
  const result=await chrome.scripting.executeScript({target:{tabId},func:(act,arg)=>{
    const api=window.__accessibleAutofillV3;
    if(!api)throw Error('Page scanner unavailable. Press Start again.');
    return act==='scan'?api.scan():act==='meta'?api.meta():act==='navigate'?api.navigate(arg):api.apply(arg);
  },args:[action,data]});
  return result[0]?.result;
}
function localMatch(item){
  const q=`${item.question||''} ${item.autocomplete||''}`.toLowerCase();
  if(/\b(given-name|given name|first name|forename|forenames)\b/.test(q))return 'firstName';
  if(/\b(family-name|family name|last name|surname|second name)\b/.test(q))return 'lastName';
  if(/\b(full name|your name|applicant name|legal name)\b/.test(q)&&!/\b(first|last|family|given|surname)\b/.test(q))return 'fullName';
  if(/\b(national insurance|ni number|nino)\b/.test(q))return 'nationalInsuranceNumber';
  if(/\b(preferred contact method|contact method|preferred method of contact|how (?:should|may|can|would).*contact you|how do you (?:prefer|wish).*contact)\b/.test(q))return 'preferredContactMethod';
  if(/\b(how.*receive.*letters|letters.*(post|email|format)|letter.*preference|written correspondence|correspondence preference)\b/.test(q))return 'letterPreference';
  if(/\b(support.*already.*(use|receive|have)|existing support|currently.*(support|aids))\b/.test(q))return 'existingSupport';
  if(/\b(e.?mail)\b/.test(q))return 'email';
  if(/\b(phone|mobile|telephone|contact number)\b/.test(q))return 'phone';
  if(/\b(date of birth|dob|birth ?date|birthday|birth)\b/.test(q))return 'dateOfBirth';
  if(/\b(city|town|locality)\b/.test(q))return 'city';
  if(/\b(state|province|county|region)\b/.test(q))return 'county';
  if(/\b(postcode|postal code|zip code|zip)\b/.test(q))return 'postcode';
  if(/\b(country)\b/.test(q))return 'country';
  if(/\b(current address|home address|street address|address line ?1|residential address)\b/.test(q))return 'addressLine1';
  return 'unknown';
}
async function askBackend(route,body){
  const response=await fetch(`http://127.0.0.1:3000/${route}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!response.ok)throw Error(`${route}: HTTP ${response.status}`);
  return response.json();
}
function formatAnswer(key,value,item){
  if(key!=='dateOfBirth'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!item.dobPart)return value;
  const [year,,day]=value.split('-');
  return item.dobPart==='day'?String(Number(day)):item.dobPart==='year'?year:
    new Date(`${value}T12:00:00`).toLocaleString('en-GB',{month:'long'});
}
function choiceCandidates(item){
  if(item.kind==='select')return (item.options||[]).map(x=>({id:item.id,value:x.value,label:x.label}));
  if(item.kind==='radio')return (item.controls||[]).map(x=>({id:x.id,value:x.id,label:x.label}));
  return [];
}
function selectedChoice(item,key,value){
  const desired=norm(formatAnswer(key,value,item));
  return choiceCandidates(item).find(x=>{
    if(norm(x.label)===desired||norm(x.value)===desired)return true;
    if(key!=='dateOfBirth'||!item.dobPart||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
    const [year,month,day]=value.split('-');
    const n=item.dobPart==='day'?Number(day):item.dobPart==='year'?Number(year):Number(month);
    if([x.label,x.value].some(z=>/^\d+$/.test(safe(z))&&Number(z)===n))return true;
    return item.dobPart==='month'&&norm(x.label).startsWith(norm(new Date(`${value}T12:00:00`).toLocaleString('en-GB',{month:'short'})));
  })||null;
}
// Never infer agreement to a declaration, contract or opt-in from saved profile data.
function isConsentCheckbox(item){
  return /\b(i agree|i consent|i confirm|i declare|terms(?: and conditions)?|privacy policy|permission|authoris[ez]|sign up|subscribe|marketing|accept|declaration|certify|acknowledge|understand and agree)\b/i.test(item.question||'');
}
function checkboxSuggestion(item,key,saved){
  if(isConsentCheckbox(item))return null;
  const label=norm(item.label);
  if(!label||label.length<3)return null;
  const values=safe(saved).split(/[,;\n]+|\s+and\s+/i).map(norm).filter(Boolean);
  // Exact option match, not keyword overlap: "screen" must not select "screen magnifier".
  if(values.some(v=>v===label))return {id:item.id,action:'check'};
  return null;
}
function isFilled(item){return item.kind==='radio'?!!item.checked:item.kind==='checkbox'?!!item.checked:!!item.hasValue}
function proposed(item,key){
  let saved=safe(profile()[key]);
  if(!saved&&key==='firstName'&&safe(profile().fullName))saved=safe(profile().fullName).split(/\s+/)[0];
  // Never guess the surname from a full name: compound surnames are common.
  if(!saved||isFilled(item))return null;
  if(item.kind==='checkbox')return checkboxSuggestion(item,key,saved);
  if(item.kind==='radio'||item.kind==='select'){
    const option=selectedChoice(item,key,saved);
    return option?{id:option.id,action:item.kind,value:option.value}:null;
  }
  if(item.kind==='date'&&!/^\d{4}-\d{2}-\d{2}$/.test(saved))return null;
  // Google Forms' date input and date text types are handled by the page helper.
  return {id:item.id,action:'text',value:formatAnswer(key,saved,item)};
}
function syncButtons(){
  const yesNo=['approveBatch','confirmSensitive','confirmCheckbox','confirmAnswer','confirmSubmit'].includes(stage);
  $('yes').disabled=!yesNo||busy;
  $('no').disabled=!yesNo||busy;
  $('answers').hidden=!['answer','choose','confirmAnswer'].includes(stage);
  $('useAnswer').hidden=!['answer','choose'].includes(stage);
  $('saveWrap').hidden=stage!=='answer'||!current?.key||current.key==='unknown'||SENSITIVE.has(current.key);
  $('endDictation').hidden=!(stage==='answer'&&current?.item?.longAnswer);
  $('yes').textContent=stage==='approveBatch'?'Yes — fill known answers':stage==='confirmSubmit'?'Yes — submit form':'Yes';
  $('no').textContent=stage==='approveBatch'?'No — ask me instead':stage==='confirmSubmit'?'No — cancel':'No / Skip';
  $('submitForm').hidden=!['complete','confirmSubmit'].includes(stage);
  $('nextPage').hidden=stage!=='pageTransition';
}
async function createPlan(){
  const stamp=session;
  plan=[];
  for(let i=0;i<questions.length;i++){
    if(stamp!==session||stopped)return;
    const item=questions[i];
    let key=localMatch(item);
    if(item.kind==='checkbox'&&!isConsentCheckbox(item)){
      // The group's question determines which profile value contains selected options.
      const group=norm(item.groupQuestion||item.question);
      if(/\b(support|aid|equipment|assistive|accessibility)\b/.test(group))key='existingSupport';
      else if(/\b(letter|correspondence|contact preference|preferred format)\b/.test(group))key='letterPreference';
    }
    if(item.kind!=='checkbox'&&key==='unknown'){
      try{const result=await askBackend('match',{question:item.question,inputType:item.inputType||item.kind,autocomplete:item.autocomplete||''});
        if(KEYS.includes(result.profileKey))key=result.profileKey;
      }catch(err){console.warn('Match unavailable:',err.message)}
    }
    plan.push({item,key,suggestion:proposed(item,key)});
    setStatus(`Understanding form field ${i+1} of ${questions.length}…`);
  }
}
async function showOverview({firstPage=true}={}){
  const available=plan.filter(p=>p.suggestion);
  const ordinary=available.filter(p=>!SENSITIVE.has(p.key));
  const sensitive=available.filter(p=>SENSITIVE.has(p.key));
  const missing=plan.filter(p=>!isFilled(p.item)&&!p.suggestion && !(p.item.kind==='checkbox'&&!isConsentCheckbox(p.item))).length;
  let simple='';
  // Give the explanatory Gemini summary once at the beginning of the form.
  // Later pages only need a short status and the autofill approval prompt.
  if(firstPage){
    try{
      const result=await askBackend('overview',{title:safe(meta.title),description:safe(meta.description),questions:questions.map(q=>q.question).slice(0,100)});
      simple=safe(result.summary);
    }catch(err){console.warn('Overview unavailable:',err.message)}
    if(!simple)simple=`${safe(meta.title)||'This form'} asks for ${[...new Set(questions.map(q=>safe(q.question)).filter(Boolean))].slice(0,2).join(' and ')||'your information'}.`;
  }
  const page=meta.pageCount?`Page ${meta.pageNumber||'?'} of ${meta.pageCount}. `:firstPage&&meta.hasNext?'More pages follow. ':'';
  const counts=`${questions.length} fields here. ${ordinary.length} saved answers ready to fill. ${sensitive.length} need private approval. ${missing} still need answers.`;
  const intro=`${firstPage?simple+' ':''}${page}${counts} ${ordinary.length?'Fill the saved answers? Say yes or no.':'Let’s answer the remaining questions.'}`;
  $('overview').hidden=!firstPage;
  if(firstPage){$('overviewText').textContent=simple+' '+page;$('overviewCounts').textContent=counts;}
  $('progress').textContent=counts;
  stage=ordinary.length?'approveBatch':'questions';
  syncButtons();
  if(ordinary.length){speak(intro,true)}
  else{ // speak first; continue after the overview narration, not during it
    const wait=()=>{if(stage==='questions'&&!stopped)nextQuestion()};
    // voice synthesizer owns the intro; begin question processing on its end
    if('speechSynthesis'in window){
      // attach our own transition utterance rather than guessing a duration
      stopSpeaking();lastSpoken=intro;setPrompt(intro);
      const u=new SpeechSynthesisUtterance(intro);u.lang='en-GB';u.rate=1.04;u.onend=wait;u.onerror=wait;speechSynthesis.speak(u);
    }else wait();
  }
}
async function approveBatch(yes){
  if(busy||stage!=='approveBatch')return;
  busy=true;stopListening();stopSpeaking();syncButtons();
  const fill=plan.filter(p=>p.suggestion&&!SENSITIVE.has(p.key));
  let success=0,fail=0;
  if(yes){
    for(const p of fill){
      if(stopped)break;
      try{
        const result=await inPage('apply',p.suggestion);
        if(result?.ok){success++;completed++;p.applied=true;}else fail++;
      }catch(err){fail++;console.warn('Batch field failed:',err.message)}
    }
  }
  if(success)successBeep();
  // Rescan to ensure the subsequent conversation uses current field state.
  try{questions=await inPage('scan');plan=plan.map((p,i)=>({...p,item:questions[i]||p.item}));}
  catch(err){console.warn('Could not rescan:',err.message)}
  cursor=0;busy=false;stage='questions';syncButtons();
  setStatus(yes?`Autofilled ${success} answers${fail?`; ${fail} could not be filled`:''}.`:'No batch autofill performed.');
  const line=yes?`I filled ${success} saved answers. Now let's review anything still missing.`:'Okay. I will ask about those answers instead.';
  // Begin after speech ends, rather than overlapping the next question.
  stopSpeaking();lastSpoken=line;setPrompt(line);
  if('speechSynthesis'in window){const u=new SpeechSynthesisUtterance(line);u.lang='en-GB';u.rate=1.04;u.onend=()=>{if(!stopped)nextQuestion()};u.onerror=()=>{if(!stopped)nextQuestion()};speechSynthesis.speak(u)}
  else await nextQuestion();
}
async function simplify(item){
  try{const result=await askBackend('simplify',{question:item.question,kind:item.kind,options:choiceCandidates(item).map(x=>x.label).slice(0,15)});return safe(result.simpleQuestion)||item.question}
  catch(err){console.warn('Simplify failed:',err.message);return item.question}
}
async function nextQuestion(){
  if(stopped||busy)return;
  busy=true;stopListening();stopSpeaking();endDictationMode();pending=null;
  while(cursor<plan.length && (plan[cursor].applied||isFilled(plan[cursor].item)))cursor++;
  if(cursor>=plan.length){
    busy=false;
    if(meta.hasNext){
      stage='pageTransition';syncButtons();
      setStatus('Finished this page. Moving to the next page…');
      speak('I have finished this page. I will move to the next page now.');
      await advancePage();
      return;
    }
    stage='complete';syncButtons();
    setStatus(`Finished the visible form. ${completed} fields filled. Nothing submitted.`);
    speak(`I have finished the form. I filled ${completed} answers. Please review them. When you are ready, say submit form or press Review and submit. I will ask for a final confirmation.`,true);
    return;
  }
  const p=plan[cursor];const item=p.item;current={...p,description:''};
  $('progress').textContent=`Question ${cursor+1} of ${plan.length}. ${completed} fields filled.`;
  setStatus(`Preparing question ${cursor+1}…`);
  const description=await simplify(item);
  if(stopped)return;
  current.description=description;
  const saved=safe(profile()[p.key]);
  if(item.kind==='checkbox'){
    if(p.suggestion){
      stage='confirmSensitive';pending=p.suggestion;syncButtons();busy=false;
      speak(`${item.question}. Your saved profile matches this choice. May I tick it? Say yes or no.`,true);return;
    }
    if(!isConsentCheckbox(item)&&safe(profile()[p.key])){
      // Saved selections exist: leave nonmatching options unchecked.
      cursor++;busy=false;stage='questions';syncButtons();await nextQuestion();return;
    }
    stage='confirmCheckbox';pending={id:item.id,action:'check'};
    syncButtons();busy=false;
    speak(`${item.question}. Would you like to tick this ${isConsentCheckbox(item)?'declaration or permission ':''}checkbox? Say yes or no.`,true);return;
  }
  if(p.suggestion&&SENSITIVE.has(p.key)){
    stage='confirmSensitive';pending=p.suggestion;
    syncButtons();busy=false;
    const value=p.key==='nationalInsuranceNumber'?'your saved National Insurance number':'the information saved in your profile';
    speak(`${description} I have ${value}. This is sensitive information. May I enter it into this form? Say yes or no.`,true);return;
  }
  if(p.suggestion){
    // A rejected batch is handled as explicit individual choices without implicit fill.
    stage='confirmSensitive';pending=p.suggestion;syncButtons();busy=false;
    speak(`${description} I have an answer saved. May I use it? Say yes or no.`,true);return;
  }
  if(item.kind==='radio'||item.kind==='select'){
    const choices=choiceCandidates(item);current.choices=choices;stage='choose';
    $('answer').value='';$('answerLabel').textContent='Choose an option';syncButtons();busy=false;
    const spoken=choices.length?choices.slice(0,12).map((x,i)=>`Option ${i+1}: ${x.label}`).join('. '):'No options were detected.';
    speak(`${description}. ${spoken}. Say the option number or type it. Say skip to leave it blank.`,true);return;
  }
  stage='answer';dictation=[];dictationRunning=!!item.longAnswer;
  $('answer').value='';$('answerLabel').textContent=description;
  $('saveAnswer').checked=false;syncButtons();busy=false;
  if(item.longAnswer){
    speak(`${description}. Please tell me your answer. You can pause between sentences. Say “end answer” when finished, or use the End long answer button.`,true);
  }else{
    speak(`${description}. Please tell me your answer, or type it. Say skip to leave it blank.`,true);
  }
}
async function applyPending(){
  if(busy||!pending)return;
  busy=true;stopListening();stopSpeaking();endDictationMode();syncButtons();
  try{
    const outcome=await inPage('apply',pending);
    if(outcome?.ok){completed++;successBeep();
      if(current?.save&&current.key!=='unknown'&&!SENSITIVE.has(current.key)&&pending.action==='text'){
        profiles[activeId][current.key]=pending.value;await chrome.storage.local.set({profiles});
      }
      setStatus('Answer applied.');
    }else setStatus(`Could not fill: ${outcome?.message||'unknown error'}`);
  }catch(err){setStatus(`Could not apply: ${err.message}`)}
  cursor++;busy=false;stage='questions';syncButtons();
  // Rescan after a change, allowing newly revealed dependent options to be read correctly.
  try{
    const fresh=await inPage('scan');
    if(fresh.length===plan.length){plan.forEach((p,i)=>{p.item=fresh[i]})}
    else if(fresh.length>plan.length){
      const known=new Set(plan.map(p=>p.item.question+'|'+p.item.kind));
      for(const item of fresh){if(!known.has(item.question+'|'+item.kind)){plan.push({item,key:localMatch(item),suggestion:null});known.add(item.question+'|'+item.kind)}}
    }
  }catch(err){console.warn('Rescan failed:',err.message)}
  await nextQuestion();
}
// Wait for Google Forms to render the next page, rather than guessing a delay.
let advancing=false;
async function advancePage(){
  if(advancing)return;
  advancing=true;
  const stamp=session;
  try{
    const before=questions.map(x=>`${x.kind}|${x.question}`).join('\n');
    const result=await inPage('navigate',{action:'next'});
    if(!result?.ok)throw Error(result?.message||'Next button unavailable');
    for(let attempt=0;attempt<30;attempt++){
      if(stopped||stamp!==session)return;
      await new Promise(resolve=>setTimeout(resolve,350));
      // A page may reload, which destroys the injected script.
      try{
        await chrome.scripting.executeScript({target:{tabId},files:['content.js']});
        const fresh=await inPage('scan');
        const nextMeta=await inPage('meta');
        const signature=fresh.map(x=>`${x.kind}|${x.question}`).join('\n');
        if(fresh.length&&(signature!==before||nextMeta.pageNumber!==meta.pageNumber&&nextMeta.pageNumber!=null)){
          questions=fresh;meta=nextMeta;cursor=0;plan=[];
          stage='planning';busy=false;setStatus('Reading the next page…');
          await createPlan();
          if(stopped||stamp!==session)return;
          await showOverview({firstPage:false});return;
        }
      }catch(err){console.debug('Waiting for next page:',err.message)}
    }
    throw Error('The next page did not become available. Check required fields and any validation messages.');
  }catch(err){
    if(stopped||stamp!==session)return;
    stage='pageTransition';syncButtons();
    setStatus(`Could not move to the next page: ${err.message}`);
    speak(`I could not move to the next page. Please check any required questions, then say next page to retry.`,true);
  }finally{advancing=false}
}
function requestSubmission(){
  if(busy||!['complete','pageTransition'].includes(stage))return;
  if(meta.hasNext){setStatus('There are more pages to complete before submission.');return}
  stopListening();stopSpeaking();stage='confirmSubmit';syncButtons();
  speak('You are about to submit this form. This sends your answers to the organisation. Are you sure you want to submit? Say yes submit, or no cancel.',true);
}
async function submitConfirmed(){
  if(stage!=='confirmSubmit'||busy)return;
  busy=true;stopListening();stopSpeaking();syncButtons();
  try{
    const result=await inPage('navigate',{action:'submit'});
    if(!result?.ok)throw Error(result?.message||'Submit button unavailable');
    // The form may navigate or show required-field errors after the click.
    // Only play the submission ding when a confirmation page is detected.
    let confirmed=false;
    for(let attempt=0;attempt<12;attempt++){
      if(stopped)break;
      await new Promise(resolve=>setTimeout(resolve,250));
      try{if(await hasSubmissionConfirmation()){confirmed=true;break;}}catch(err){console.debug('Waiting for confirmation:',err.message)}
    }
    stage='submitted';
    if(confirmed){
      submissionDing();
      setStatus('Submission confirmed by the webpage.');
      speak('Your form was submitted successfully.');
    }else{
      setStatus('Submit was clicked, but confirmation could not be verified. Check the webpage for errors.');
      speak('I pressed Submit, but could not confirm it went through. Please check the webpage.');
    }
  }catch(err){stage='complete';setStatus(`Could not submit: ${err.message}`);speak('I could not submit the form. Please review it and try again.');}
  finally{busy=false;syncButtons()}
}
function skipQuestion(){
  if(busy||['idle','complete','submitted','pageTransition','confirmSubmit'].includes(stage))return;
  if(stage==='approveBatch'){approveBatch(false);return}
  stopListening();stopSpeaking();endDictationMode();cursor++;stage='questions';syncButtons();nextQuestion();
}
function answerFromInput(){
  if(busy||!current)return;
  const value=safe($('answer').value);
  if(!value){setStatus('Please enter or say an answer.');return}
  if(stage==='choose'){
    const choices=current.choices||[];
    let choice=null;
    const n=Number(value.match(/\d+/)?.[0]);
    if(Number.isInteger(n)&&n>=1&&n<=choices.length)choice=choices[n-1];
    if(!choice)choice=choices.find(x=>norm(x.label)===norm(value));
    if(!choice){setStatus('I could not match that option. Say its number or type its name.');return}
    pending={id:choice.id,action:current.item.kind,value:choice.value};
    stage='confirmAnswer';syncButtons();speak(`You chose ${choice.label}. Shall I enter that? Say yes or no.`,true);return;
  }
  if(stage==='answer'){
    endDictationMode();current.save=$('saveAnswer').checked;
    pending={id:current.item.id,action:'text',value};stage='confirmAnswer';syncButtons();
    const spoken=value.length>280?`${value.slice(0,280)}. The answer is longer than this preview.`:value;
    speak(`I recorded: ${spoken}. Shall I fill it in? Say yes or no.`,true);
  }
}
function noResponse(){
  if(stage==='approveBatch'){approveBatch(false);return}
  if(stage==='confirmSubmit'){stage='complete';syncButtons();speak('Submission cancelled. Your form has not been submitted.');return}
  if(stage==='confirmAnswer'){
    stage=current.item.kind==='radio'||current.item.kind==='select'?'choose':'answer';
    pending=null;dictationRunning=false;syncButtons();
    speak('Okay. Correct the answer using your microphone or keyboard, or say skip.',true);return;
  }
  skipQuestion();
}
function handleSpeech(heard){
  if(stopped||busy)return;
  const h=norm(heard);if(!h)return;
  if(stage==='confirmSubmit'){
    if(/^(yes submit|submit yes|confirm submit|yes|submit now)$/.test(h)){submitConfirmed();return}
    if(/^(no|cancel|no cancel|do not submit)$/.test(h)){noResponse();return}
    setStatus('Please say yes submit or no cancel.');return;
  }
  if(/^(submit form|submit my form|send form|send my form)$/.test(h)){requestSubmission();return}
  if(/^(next page|continue to next page|go to next page)$/.test(h)&&stage==='pageTransition'){advancePage();return}
  if(stage==='complete'){
    setStatus('Say submit form to review submission, or use Review and submit.');return;
  }
  if(/^(skip|next|leave blank|pass)$/.test(h)){skipQuestion();return}
  if(['approveBatch','confirmSensitive','confirmCheckbox','confirmAnswer'].includes(stage)){
    if(/^(yes|yeah|yep|correct|confirm|okay|ok|go ahead|please do|thats right)$/.test(h)){
      if(stage==='approveBatch')approveBatch(true);else applyPending();return;
    }
    if(/^(no|nope|dont|incorrect|cancel)$/.test(h)){noResponse();return}
    setStatus('Please say yes or no, or use the buttons.');return;
  }
  if(stage==='answer'||stage==='choose'){$('answer').value=heard;answerFromInput()}
}
async function start(){
  if(busy)return;
  session++;stopped=false;stopListening();stopSpeaking();endDictationMode();
  if(!activeId)return setStatus('Create a saved profile first.');
  busy=true;stage='idle';syncButtons();$('overview').hidden=true;setStatus('Finding the form…');
  try{
    const win=await chrome.windows.getLastFocused({windowTypes:['normal']});
    if(!win?.id)throw Error('Could not find a normal Chrome window.');
    const [tab]=await chrome.tabs.query({active:true,windowId:win.id});
    if(!tab?.id||!/^https?:\/\//.test(tab.url||''))throw Error('Open a Google Form in a normal Chrome tab first.');
    tabId=tab.id;
    const origin=new URL(tab.url).origin+'/*';
    if(!await chrome.permissions.contains({origins:[origin]})){
      try{await chrome.scripting.executeScript({target:{tabId},func:()=>true})}
      catch{if(!await chrome.permissions.request({origins:[origin]}))throw Error('Website access was not granted.');}
    }
    await chrome.scripting.executeScript({target:{tabId},files:['content.js']});
    questions=await inPage('scan');meta=await inPage('meta');
    if(!questions?.length)throw Error('No supported visible form fields found.');
    cursor=0;completed=0;stage='planning';
    await createPlan();
    if(stopped)return;
    busy=false;await showOverview();
  }catch(err){busy=false;stage='idle';syncButtons();setStatus(`Could not start: ${err.message}`)}
}
$('start').addEventListener('click',start);
$('submitForm').addEventListener('click',requestSubmission);
$('nextPage').addEventListener('click',advancePage);
$('yes').addEventListener('click',()=>{if(stage==='approveBatch')approveBatch(true);else if(['confirmSensitive','confirmCheckbox','confirmAnswer'].includes(stage))applyPending();else if(stage==='confirmSubmit')submitConfirmed()});
$('no').addEventListener('click',noResponse);
$('useAnswer').addEventListener('click',answerFromInput);
$('endDictation').addEventListener('click',finishDictation);
$('next').addEventListener('click',skipQuestion);
$('stop').addEventListener('click',()=>{session++;stopped=true;stage='idle';endDictationMode();stopSpeaking();syncButtons();setStatus('Stopped. Nothing submitted.')});
$('repeat').addEventListener('click',()=>{if(lastSpoken){speak(lastSpoken,true)}});
$('original').addEventListener('click',()=>{if(current?.item?.question){dictationRunning=false;speak(`Original wording: ${current.item.question}`,false)}});
$('listen').addEventListener('click',()=>{stopSpeaking();if(stage==='answer'&&current?.item?.longAnswer){dictation=[$('answer').value].filter(Boolean);dictationRunning=true;syncButtons()}listen(false)});
$('manage').addEventListener('click',()=>chrome.tabs.create({url:chrome.runtime.getURL('popup.html')}));
$('profile').addEventListener('change',async e=>{session++;endDictationMode();stopSpeaking();stopped=true;stage='idle';activeId=e.target.value;await chrome.storage.local.set({activeProfileId:activeId});syncButtons();setStatus('Profile changed. Press Start to rescan the form.')});
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&(changes.profiles||changes.activeProfileId))readProfiles()});
syncButtons();readProfiles().catch(err=>setStatus(err.message));
