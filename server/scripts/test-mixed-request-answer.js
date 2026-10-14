const fs = require('fs'), path = require('path'), vm = require('vm');
const { mixedRequestAnswer } = require('../services/mixedRequestAnswer');
let passed=0, failed=0;
const check=(name,ok)=>{console.log(`  ${ok?'✓':'✗'} ${name}`);ok?passed++:failed++;};
const filename = path.resolve(__dirname, '../routes/aiChat.js'), router = {};
for (const method of ['use', 'get', 'post', 'put', 'patch', 'delete']) router[method] = () => router;
let fixture = {}, prompts = [], queries = [], failAnswer = false, formats = [];
const pure = new Set(['../services/personName', '../services/scaleParse', '../services/macroCheck', '../services/fatProfile', '../services/nutrients',
  '../services/voiceLanguage', '../services/programDay', '../utils/istDate', '../services/safety', '../services/foodReview', '../services/draftFoodReview', '../services/sleepReview', '../services/mixedRequestAnswer']);
const moduleFixture = { exports: {} };
const sandbox = { module: moduleFixture, exports: moduleFixture.exports, console, setTimeout, clearTimeout,
  process: { env: { GROQ_API_KEY: 'sleep-fixture', GROQ_MODEL: 'fixture-model', GROQ_FALLBACK_MODEL: 'fixture-model' } },
  require(name) {
    if (name === 'express') return { Router: () => router };
    if (name === '../db/pool') return { query: async (sql, args) => { queries.push({ sql, args }); return { rows: /COUNT\(\*\)/.test(sql) ? [{ n: 0 }] : [] }; } };
    if (name === 'axios') return { post: async (url, body) => { prompts.push(body.messages[0].content); formats.push(body.response_format?.type); if(failAnswer && prompts.length > 1) throw Object.assign(new Error('provider unavailable'), {response:{status:503}}); return { data: { choices: [{ finish_reason: 'stop', message: { content: prompts.length % 2 === 0 ? 'You have no saved water entries yet.' : JSON.stringify(fixture) } }] } }; } };
    if (name === '../middleware/auth') return () => {};
    if (name === '../middleware/roleCheck') return () => () => {};
    if (name === '../services/circuits') return { circuitsPromptBlock: () => '', matchCircuit: () => null };
    if (name === '../services/memberFoods') return { findLabel: async () => null };
    if (name === '../services/digests') return { computeDayTotals: () => ({}) };
    if (name === '../services/dietPlan') return { memberPlanLines: async () => [] };
    if (name === './programs') return { loadProgramDays: async () => [] };
    if (name === 'crypto') return require('crypto');
    if (pure.has(name)) return require(path.resolve(path.dirname(filename), name));
    throw new Error(`Unexpected dependency ${name}`);
  },
};
vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename, timeout: 5000 });
const api = moduleFixture.exports;
api.setControlSampler(() => false);

(async()=>{
 for(const question of ['How much water is left?', 'कितना पानी बाकी है?', 'ಇನ್ನೂ ಎಷ್ಟು ನೀರು ಬೇಕು?', '500ml piya, aur kitna?']) {
  prompts=[]; queries=[]; formats=[]; fixture={water_ml_add:500,mixed_question:question};
  const r=await api.parseMemberMessage({userId:999,message:'Drank 500ml water. '+question,context:{}});
  check('mixed request retains water review: '+question,r.water_ml_add===500);
  check('mixed request returns separately scoped answer',r.advice?.basis==='saved_snapshot'&&r.advice.question===question&&r.advice.text==='You have no saved water entries yet.');
  check('answer uses saved data and excludes pending review',prompts.length===2&&prompts[1].includes('Today: nothing logged yet.')&&prompts[1].includes('Do not add pending entries'));
  check('parser requires JSON while optional prose answer uses text',formats[0]==='json_object'&&formats[1]===undefined);
  check('mixed parse does not write member logs',queries.every(({sql})=>!/(?:INSERT INTO|UPDATE)\s+(?:daily_logs|workout_sessions)/i.test(sql)));
 }
 prompts=[]; queries=[]; failAnswer=true; fixture={water_ml_add:500,mixed_question:'How much is left?'};
 const degraded=await api.parseMemberMessage({userId:999,message:'Drank 500ml. How much is left?',context:{}});
 check('actual parser retains draft when answering fails',degraded.water_ml_add===500&&degraded.advice?.unavailable===true&&!degraded.__status);
 check('optional answer does not enter provider retry loop',prompts.length===2);
 failAnswer=false;
 let called=0;
 check('missing question does not call answer service',await mixedRequestAnswer(null,{context:()=>called++})===null&&called===0);
 const unavailable=await mixedRequestAnswer('Question',{context:async()=>{throw Error('DB unavailable');},answer:()=>called++});
 check('context failure returns recoverable notice',unavailable.unavailable===true&&called===0);
 const empty=await mixedRequestAnswer('Question',{context:async()=>'',answer:async()=>''});
 check('empty answer returns recoverable notice',empty.unavailable===true);
 const timeout=await mixedRequestAnswer('Question',{context:()=>new Promise(()=>{}),answer:()=>'',timeoutMs:5});
 check('slow answer has a bounded wait',timeout.unavailable===true);
 const bounded=await mixedRequestAnswer('q'.repeat(500),{context:async()=>'',answer:async()=> 'x'.repeat(1000)});
 check('response and question length bounded',bounded.question.length===300&&bounded.text.length===700);
 console.log(`\n${passed} passed, ${failed} failed`);if(failed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
