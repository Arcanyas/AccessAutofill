const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const nodes=new Map();
function element(id){
  if(!nodes.has(id))nodes.set(id,{
    id,hidden:false,disabled:false,checked:false,value:'',textContent:'',
    addEventListener:()=>{},replaceChildren:()=>{},add:()=>{},
  });
  return nodes.get(id);
}
const context={
  console, setTimeout,clearTimeout,
  document:{getElementById:element,addEventListener:()=>{}},
  window:{SpeechRecognition:null,webkitSpeechRecognition:null,speechSynthesis:{cancel:()=>{}}},
  chrome:{storage:{local:{get:async()=>({profiles:{},activeProfileId:null})},onChanged:{addListener:()=>{}}},
    tabs:{},permissions:{},scripting:{},windows:{}},
  Option:function(label,value){this.label=label;this.value=value},
  SpeechSynthesisUtterance:function(){},
  fetch:async()=>({ok:true,json:async()=>({})})
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(__dirname+'/voice.js','utf8'),context);
vm.runInContext(`profiles={demo:{firstName:'Vijay',lastName:'Patel',existingSupport:'Screen reader, White cane',letterPreference:'Large print',nationalInsuranceNumber:'TEST',preferredContactMethod:'Email'}};activeId='demo'`,context);
function evaluate(source){return vm.runInContext(source,context)}
for(const [question,autocomplete,expected] of [
  ['First name','','firstName'],['Forename','','firstName'],['Given name','','firstName'],
  ['Surname','','lastName'],['Family name','','lastName'],['Last name','','lastName'],
  ['Name','given-name','firstName'],['Name','family-name','lastName'],
  ['Your National Insurance number','','nationalInsuranceNumber'],
  ['Preferred contact method','','preferredContactMethod'],
  ['How would you like us to contact you?','','preferredContactMethod'],
]){
  assert.equal(evaluate(`localMatch(${JSON.stringify({question,autocomplete})})`),expected,question);
}
assert.equal(evaluate(`proposed({kind:'text',id:'n1',question:'First name',hasValue:false},'firstName')?.value`),'Vijay');
assert.equal(evaluate(`proposed({kind:'text',id:'n2',question:'Surname',hasValue:false},'lastName')?.value`),'Patel');
assert.equal(evaluate(`proposed({kind:'checkbox',id:'s1',question:'Support — Screen reader',label:'Screen reader',checked:false},'existingSupport')?.action`),'check');
assert.equal(evaluate(`proposed({kind:'checkbox',id:'s2',question:'Support — White cane',label:'White cane',checked:false},'existingSupport')?.action`),'check');
assert.equal(evaluate(`proposed({kind:'checkbox',id:'s3',question:'Support — Hearing aid',label:'Hearing aid',checked:false},'existingSupport')`),null);
assert.equal(evaluate(`proposed({kind:'checkbox',id:'x',question:'I agree to the terms',label:'I agree to the terms',checked:false},'existingSupport')`),null);
assert.equal(evaluate(`proposed({kind:'checkbox',id:'l',question:'Letters — Large print',label:'Large print',checked:false},'letterPreference')?.action`),'check');
assert.equal(evaluate(`proposed({kind:'select',id:'cm',question:'Preferred contact method',hasValue:false,options:[{value:'email',label:'Email'},{value:'sms',label:'SMS'}]},'preferredContactMethod')?.value`),'email');
assert.equal(evaluate(`proposed({kind:'select',id:'cm',question:'Preferred contact method',hasValue:false,options:[{value:'sms',label:'SMS'}]},'preferredContactMethod')`),null);
console.log('PASS: contact method, names, autocomplete, sensitive option matching, and legal consent exclusions');
