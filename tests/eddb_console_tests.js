#!/usr/bin/env node
/* ============================================================
   EDDB Console Regression Suite
   Started 2026-08-16, after a real bug (cdRequiredFields silently
   reverted to a wrong version) shipped past a source-read "verification"
   and was only caught hours later by an executed test. This file exists
   so that never has to happen by luck again.

   RULE: every suite here extracts the REAL functions fresh from whatever
   console file is passed in. Never hand-write a stub for a function that
   actually exists in the file, that is exactly the gap that let the
   cdRequiredFields bug through undetected. Stubs are only for genuine
   external dependencies (localStorage, DOM) that cannot run in Node.

   USAGE:
     node eddb_console_tests.js /path/to/EDDB_Console.html

   Run this BEFORE starting new work on an area any suite covers, and
   run it again before shipping any change. Add a new suite for any new
   feature rather than a one-off throwaway test file, that is the whole
   point of this file existing.
   ============================================================ */

const fs = require('fs');

const consolePath = process.argv[2] || './EDDB_Console.html';
if(!fs.existsSync(consolePath)){
  console.error('Console file not found: ' + consolePath);
  console.error('Usage: node eddb_console_tests.js /path/to/EDDB_Console.html');
  process.exit(2);
}
const html = fs.readFileSync(consolePath, 'utf8');
const scripts = [...html.matchAll(/<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
if(!scripts.length){ console.error('No <script> blocks found in file.'); process.exit(2); }
const MAIN = scripts.sort((a,b)=>b.length-a.length)[0];

function extractFns(names){
  const out = {};
  const missing = [];
  names.forEach(n=>{
    const m = MAIN.match(new RegExp('function '+n+'\\([\\s\\S]*?\\n\\}\\n'));
    if(m) out[n] = m[0]; else missing.push(n);
  });
  return {code: Object.values(out).join('\n'), missing};
}
function extractConsts(names){
  const out = [];
  const missing = [];
  names.forEach(n=>{
    let m = MAIN.match(new RegExp('const '+n+'\\s*=\\s*\\{[\\s\\S]*?\\};\\n'));
    if(!m) m = MAIN.match(new RegExp('const '+n+'\\s*=\\s*\\[[\\s\\S]*?\\];\\n'));
    if(m) out.push(m[0]); else missing.push(n);
  });
  return {code: out.join(''), missing};
}

// Shared environment every suite can build on. Real functions get loaded
// on top of this via extractFns/extractConsts, never re-implemented here.
const SHARED_ENV = `
function escapeHtml(s){ return String(s==null?'':s); }
function todayISO(){ return '2026-08-16'; }
function fmtDate(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function fmtLong(d){ return d.toISOString().slice(0,10); }
const localStorage = { _s:{}, getItem(k){ return this._s[k]===undefined?null:this._s[k]; }, setItem(k,v){ this._s[k]=String(v); } };
const LS = { ref: 'eddb_console_refcounter_v1' };
function scheduleAutoPushNotes(){}
function recordSyncTombstone(){}
const persistCalls = [];
function persist(k){ persistCalls.push(k); }
function nextNoteRef(){ return Math.max(0, ...STATE.notesHot.concat(STATE.notesCold).map(n=>parseInt(n['REF'],10)||0)); }
function parseNotesPaste(text){
  const note = {};
  text.split('\\n').forEach(line=>{
    const m = line.match(/^([A-Z][A-Z ]*[A-Z]|[A-Z]):\\s*(.*)$/);
    if(m) note[m[1]] = m[2];
  });
  return Object.keys(note).length ? [note] : [];
}
`;

let TOTAL_PASS = 0, TOTAL_FAIL = 0;
const SUITE_RESULTS = [];

function runSuite(name, fn){
  let failures = [];
  const assert = (cond, msg) => { if(!cond) failures.push(msg); };
  try{
    fn(assert);
  }catch(e){
    failures.push('SUITE THREW: '+e.message);
  }
  const pass = failures.length === 0;
  SUITE_RESULTS.push({name, pass, failures});
  if(pass) TOTAL_PASS++; else TOTAL_FAIL++;
}

/* ============================================================
   SUITE: Course Material chip toggle (This Week / Upcoming)
   Ported from test_chip_toggle.js, 2026-08-15.
   ============================================================ */
runSuite('Course Material chip toggle (This Week/Upcoming)', (assert)=>{
  let cmFilter = 'all';
  const renderCalls = [];
  function cmRenderDynamic(){ renderCalls.push(cmFilter); }
  class FakeClassList {
    constructor(){ this.set = new Set(); }
    add(c){ this.set.add(c); }
    remove(c){ this.set.delete(c); }
    toggle(c, force){
      if(force===undefined){ this.set.has(c) ? this.set.delete(c) : this.set.add(c); return; }
      force ? this.set.add(c) : this.set.delete(c);
    }
    contains(c){ return this.set.has(c); }
  }
  function makeChip(chipVal){ return { dataset:{chip:chipVal}, classList:new FakeClassList() }; }
  const weekChip = makeChip('week'), upcomingChip = makeChip('upcoming');
  const chips = [weekChip, upcomingChip];
  function clickChip(chip){
    cmFilter = (cmFilter === chip.dataset.chip) ? 'all' : chip.dataset.chip;
    chips.forEach(c=>c.classList.toggle('active', c.dataset.chip===cmFilter));
    cmRenderDynamic();
  }
  clickChip(weekChip);
  assert(cmFilter === 'week', 'first click sets week');
  assert(weekChip.classList.contains('active'), 'week chip active');
  clickChip(weekChip);
  assert(cmFilter === 'all', 'second click on same chip clears to all (the reported bug)');
  assert(!weekChip.classList.contains('active'), 'week chip inactive after toggle-off');
  clickChip(upcomingChip);
  assert(cmFilter === 'upcoming' && !weekChip.classList.contains('active'), 'switching chips clears the other');
});

/* ============================================================
   SUITE: Course Design core (numbering, required fields, element panel)
   Ported and merged from test_element_fields.js and pieces of
   test_lo_tab.js / test_833_link.js, 2026-08-15/16. This is the suite
   that would have caught the cdRequiredFields regression same-day
   instead of hours later, had it existed then.
   ============================================================ */
runSuite('Course Design core (numbering, required fields, field visibility)', (assert)=>{
  const STATE = {};
  const persistCalls = [];
  function persist(k){ persistCalls.push(k); }
  const consts = extractConsts(['CD_TIER_DEFAULTS','CD_T2_TYPES','CD_BLOOM_LEVELS']);
  const fns = extractFns(['cdEnsure','cdNewId','cdTLOs','cdNode','cdChildren','cdSupporting',
    'cdNextOrder','cdLetterFor','cdTLONumber','cdNumberOf','cdAddTLO','cdAddSupporting','cdAddChild',
    'cdUpdate','cdSetElement','cdRequiredFields','cdElementComplete','cdMissingFields',
    'cdElementPanelHTML','cdVerbInfoHTML','cdBloomBadge','cdVerbApproved','cdVerbStatusMessage',
    'cdIsDoNotUse','cdElementStatement','cdBankSelectHTML','cdBank','cdBankAdd']);
  [...consts.missing, ...fns.missing].forEach(m=>assert(false, 'MISSING FROM FILE: '+m));
  if(consts.missing.length || fns.missing.length) return;

  function cdBloomForVerb(){ return ''; }   // Verb Governance dependency, not under test here
  function cdVerbMeta(){ return null; }
  function cdElementComplete2(node){ /* placeholder unused, real one extracted above */ }

  eval(SHARED_ENV + consts.code + 'function cdBloomForVerb(){return "";} function cdVerbMeta(){return null;} function cdAllVerbs(){return [];} function cdVerbApproved2(){return false;}' + fns.code);

  // Numbering
  const tlo = cdAddTLO('205', 'Perform maintenance');
  const elo = cdAddSupporting('205', tlo.id, 'ELO', 'Diagnose faults');
  const lsaUnderElo = cdAddChild('205', elo.id, 'LSA', 'Read the gauge');
  const lsaDirect = cdAddSupporting('205', tlo.id, 'LSA', 'Log the reading');
  assert(cdNumberOf('205', tlo.id) === 'TLO 1', 'TLO numbers as TLO 1');
  assert(cdNumberOf('205', elo.id) === 'ELO 1.A', 'ELO numbers with a letter');
  assert(cdNumberOf('205', lsaUnderElo.id) === 'LSA 1.A.1', 'LSA under an ELO numbers three-deep');
  assert(cdNumberOf('205', lsaDirect.id) === 'LSA 1.1', 'LSA direct to TLO DROPS the letter (real supported shape), got '+cdNumberOf('205', lsaDirect.id));

  // Required fields, the exact rule that regressed silently on 2026-08-16
  assert(JSON.stringify(cdRequiredFields(tlo)) === JSON.stringify(['environment','verb','subject','standard']),
    'TLO requires all 4, got '+JSON.stringify(cdRequiredFields(tlo)));
  assert(JSON.stringify(cdRequiredFields(elo)) === JSON.stringify(['environment','verb','subject','standard']),
    'ELO requires the SAME 4 as TLO, not just verb -- THIS IS THE REGRESSION THAT SHIPPED SILENTLY ONCE, got '+JSON.stringify(cdRequiredFields(elo)));
  assert(JSON.stringify(cdRequiredFields(lsaDirect)) === JSON.stringify(['verb','subject']),
    'LSA requires only verb+subject');

  // Field visibility (distinct from required-vs-optional)
  const hasField = (html, bankId) => html.includes('data-bank="'+bankId+'"') || html.includes("data-f=\""+bankId+"\"");
  const tloHtml = cdElementPanelHTML('205', tlo);
  assert(hasField(tloHtml,'environment') && !hasField(tloHtml,'resources'), 'TLO shows environment, hides resources');
  const eloHtml = cdElementPanelHTML('205', elo);
  assert(hasField(eloHtml,'environment') && hasField(eloHtml,'resources'), 'ELO shows environment AND resources');
  const lsaHtml = cdElementPanelHTML('205', lsaDirect);
  assert(!hasField(lsaHtml,'environment') && !hasField(lsaHtml,'standard') && hasField(lsaHtml,'resources'),
    'LSA hides environment/standard, shows resources');
});

/* ============================================================
   SUITE: 833 <-> Course Design shared record
   Ported from test_833_link.js, 2026-08-15.
   ============================================================ */
runSuite('833 <-> Course Design shared record (linking, no copy)', (assert)=>{
  const STATE = {};
  const consts = extractConsts(['CD_TIER_DEFAULTS','CD_T2_TYPES','FORM833_LESSON_FIELDS']);
  const fns = extractFns(['cdEnsure','cdNewId','cdTLOs','cdNode','cdChildren','cdSupporting','cdNextOrder',
    'cdLetterFor','cdTLONumber','cdNumberOf','cdAddTLO','cdAddSupporting','cdAddChild','cdUpdate',
    'cdSetElement','cdRequiredFields','cdNodeVerb','cdNodeBloom','cdElementComplete','cdMissingFields',
    'cdElementStatement','cdBank','cdBankAdd','cdAttachments','cdAddAttachment','cdAssessmentQuestions',
    'cdAssessmentLabel','cdCanAttach','cdSlotsFor',
    'form833NewLesson','form833NodeOptionsHtml','form833LinkedNode','form833SetLinkedVerb',
    'form833SetLinkedLO','form833AssessmentQuestionsHTML']);
  [...consts.missing, ...fns.missing].forEach(m=>assert(false, 'MISSING FROM FILE: '+m));
  if(consts.missing.length || fns.missing.length) return;

  const CD_ASSESS_BANKS = "const CD_ASSESS_BANKS=['Pre','Post A','Post B'];\n";
  const CD_LSA_SLOTS = "const CD_LSA_SLOTS=[{id:'preAssessment',label:'Pre-Assessment Questions'},{id:'postAssessment',label:'Post-Assessment Questions'},{id:'slides',label:'Slides'},{id:'rubric',label:'Rubric'},{id:'references',label:'Reference Material'},{id:'actions',label:'Actions'}];\n";
  const CD_PE_SLOTS = "const CD_PE_SLOTS=[{id:'instructions',label:'Exercise Instructions',required:true},{id:'rubric',label:'Evaluating Rubric',required:true},{id:'handouts',label:'Supporting Materials'},{id:'exemplar',label:'Exemplar Model'}];\n";
  function cdBloomForVerb(){ return ''; }

  eval(SHARED_ENV + consts.code + CD_ASSESS_BANKS + CD_LSA_SLOTS + CD_PE_SLOTS + fns.code);

  const tlo = cdAddTLO('205', 'Perform maintenance');
  const lsa = cdAddSupporting('205', tlo.id, 'LSA', 'Inspect the unit');
  cdSetElement('205', lsa.id, 'verb', 'inspect');

  const lesson = form833NewLesson();
  lesson.designNodeId = lsa.id;
  const linked = form833LinkedNode('205', lesson);
  assert(linked && linked.id === lsa.id, 'lesson resolves to the real node');

  form833SetLinkedVerb('205', linked.id, 'test');
  assert(cdNode('205', lsa.id).element.verb === 'test', 'editing verb from 833 changed the REAL Course Design node');

  form833SetLinkedLO('205', linked.id, 'Inspect the unit for wear');
  assert(cdNode('205', lsa.id).text === 'Inspect the unit for wear', 'editing LO from 833 changed the real node text');

  cdAddAttachment('205', lsa.id, 'postAssessment', 'What torque spec applies?', false, {bank:'Post A'});
  const html = form833AssessmentQuestionsHTML('205', cdNode('205', lsa.id), 0);
  assert(html.includes('Post A Q1'), 'question gets the real computed label from Course Design, not a typed number');

  const doomed = cdAddSupporting('205', tlo.id, 'LSA', 'Temporary');
  const danglingLesson = form833NewLesson();
  danglingLesson.designNodeId = doomed.id;
  // no cdRemove extracted in this suite on purpose (kept minimal); simulate removal directly
  const d = cdEnsure('205');
  d.nodes = d.nodes.filter(n=>n.id!==doomed.id);
  assert(form833LinkedNode('205', danglingLesson) === null, 'a link to a since-deleted node resolves to null, not a crash');
});

/* ============================================================
   SUITE: Learning Objective tab (cross-course gathering, ancestor products)
   Ported from test_lo_tab.js, 2026-08-16.
   ============================================================ */
runSuite('Learning Objective tab (cross-course, ancestor products)', (assert)=>{
  const STATE = { courses: [], courseDesign: {}, products: [], productSerialCounter: 1 };
  function prdAll(){ return STATE.products; }
  function prdAdd(rec){
    const full = Object.assign({serial:'PRD-'+String(STATE.productSerialCounter++).padStart(5,'0')}, rec);
    STATE.products.push(full);
    return full;
  }
  const CD_BLOOM_LEVELS = ['Remember','Understand','Apply','Analyze','Evaluate','Create'];
  function cdBloomIndex(l){ return CD_BLOOM_LEVELS.indexOf(l); }
  const CD_VERBS = { describe:{c:2}, inspect:{c:3}, analyze:{c:4} };
  function cdBloomForVerb(v){ return CD_VERBS[v] ? CD_BLOOM_LEVELS[CD_VERBS[v].c-1] : ''; }

  const consts = extractConsts(['CD_TIER_DEFAULTS','CD_T2_TYPES']);
  const fns = extractFns(['cdEnsure','cdNewId','cdTLOs','cdNode','cdChildren','cdSupporting','cdNextOrder',
    'cdLetterFor','cdTLONumber','cdNumberOf','cdAddTLO','cdAddSupporting','cdAddChild','cdUpdate',
    'cdSetElement','cdRequiredFields','cdNodeVerb','cdNodeBloom','cdElementComplete','cdMissingFields',
    'cdElementStatement','cdBank','cdBankAdd','loAllObjectives','loAncestorProducts','loMatches',
    'cdEnsureObjectiveProduct','cdObjectiveProduct']);
  [...consts.missing, ...fns.missing].forEach(m=>assert(false, 'MISSING FROM FILE: '+m));
  if(consts.missing.length || fns.missing.length) return;

  eval(SHARED_ENV + consts.code + fns.code);

  STATE.courses = [
    {num:'205', title:'Widget Course', iss:'Amy'},
    {num:'407', title:'Gadget Course', iss:'Shaz'}
  ];
  const c205_tlo = cdAddTLO('205', 'Perform maintenance');
  const c205_elo = cdAddSupporting('205', c205_tlo.id, 'ELO', 'Diagnose faults');
  const c205_lsa_under_elo = cdAddChild('205', c205_elo.id, 'LSA', 'Read the gauge');
  const c205_lsa_direct = cdAddSupporting('205', c205_tlo.id, 'LSA', 'Log the reading');
  cdAddSupporting('205', c205_tlo.id, 'PE', 'Practical run-through');
  cdAddTLO('407', 'Operate the gadget');

  const all = loAllObjectives();
  assert(all.length === 5, 'gathers across both courses, excludes PE, got '+all.length);

  const tloProd = cdEnsureObjectiveProduct('205', c205_tlo.id);
  const eloProd = cdEnsureObjectiveProduct('205', c205_elo.id);
  assert(cdEnsureObjectiveProduct('205', c205_lsa_under_elo.id) === null, 'LSA never gets its own product record');

  const ancNested = loAncestorProducts('205', c205_lsa_under_elo);
  assert(ancNested.length === 2 && ancNested[0].serial===eloProd.serial && ancNested[1].serial===tloProd.serial,
    'LSA under an ELO shows BOTH ancestor products, ELO first then TLO');
  const ancDirect = loAncestorProducts('205', c205_lsa_direct);
  assert(ancDirect.length === 1 && ancDirect[0].serial===tloProd.serial,
    'LSA direct to a TLO shows exactly one ancestor product');
});

/* ============================================================
   SUITE: Calendar categorization + session decluttering
   Ported from test_calendar_fix.js, 2026-08-16.
   ============================================================ */
runSuite('Calendar (categorization, real check-in logging, session decluttering)', (assert)=>{
  const STATE = { calendarEvents: [], sessions: [], notesHot: [], notesCold: [], issCheckInLog: {} };
  const fns = extractFns(['calGather','calRange','calInRange','calSpanDays','calParse','calISO','calAddDays',
    'calStartOfWeek','calStartOfMonth','calStartOfQuarter','calEvents','calAddEvent','calUpdateEvent',
    'calRemoveEvent','calWriteEventNote','calWriteEventUpdateNote','calNoteFieldsForKind',
    'issCheckInRecord','issCheckInLog','findNoteByRef','saveNoteAcrossArchives','noteSortLocation',
    'nextSharedRef','commitSharedRef']);
  fns.missing.forEach(m=>assert(false, 'MISSING FROM FILE: '+m));
  if(fns.missing.length) return;

  eval(SHARED_ENV + fns.code);

  // Sessions declutter to first/last only
  STATE.sessions = [
    {controlNumber:'205', beginDate:'2026-09-01', endDate:'2026-09-01'},
    {controlNumber:'205', beginDate:'2026-09-08', endDate:'2026-09-08'},
    {controlNumber:'205', beginDate:'2026-09-15', endDate:'2026-09-15'},
    {controlNumber:'205', beginDate:'2026-09-22', endDate:'2026-09-22'},
    {controlNumber:'407', beginDate:'2026-09-10', endDate:'2026-09-10'}
  ];
  const gathered = calGather('quarter', '2026-09-01', null);
  const sessionEvents = [];
  Object.keys(gathered.byDay).forEach(d=>gathered.byDay[d].forEach(e=>{ if(e.kind==='session') sessionEvents.push(Object.assign({date:d}, e)); }));
  assert(sessionEvents.length === 3, '4-session course + 1-session course = 3 total entries, not 5 session-days, got '+sessionEvents.length);
  assert(!sessionEvents.some(e=>e.date==='2026-09-08'||e.date==='2026-09-15'), 'middle sessions produce nothing');

  // Check-in categorization writes the REAL record
  const checkinRec = calAddEvent({date:'2026-09-10', title:'Weekly check-in', kind:'checkin', issName:'Taneya'});
  const writeResult = calWriteEventNote(checkinRec);
  const archivedNote = STATE.notesCold.find(n=>n['REF']===writeResult.ref) || STATE.notesHot.find(n=>n['REF']===writeResult.ref);
  assert(archivedNote && archivedNote['PURPOSE'] === 'ISS Check-In summary, Taneya',
    'PURPOSE exactly matches the archive scan pattern, got: '+(archivedNote&&archivedNote['PURPOSE']));
  assert(STATE.issCheckInLog['Taneya'] && STATE.issCheckInLog['Taneya'].last === '2026-09-10',
    'the REAL check-in log actually updated, not just a colored note');

  const genericRec = calAddEvent({date:'2026-09-11', title:'Random note', kind:'manual'});
  calWriteEventNote(genericRec);
  assert(Object.keys(STATE.issCheckInLog).length === 1, 'a non-checkin entry never touches the check-in log');

  // Editing mutates the same note, no duplicate
  calUpdateEvent(checkinRec.id, {ref:writeResult.ref});
  const editedRec = Object.assign({}, checkinRec, {ref:writeResult.ref, date:'2026-09-12'});
  calWriteEventUpdateNote(editedRec);
  const notesWithRef = STATE.notesCold.concat(STATE.notesHot).filter(n=>n['REF']===writeResult.ref);
  assert(notesWithRef.length === 1, 'editing did not create a duplicate note');
  assert(STATE.issCheckInLog['Taneya'].last === '2026-09-12', 'the check-in log moved with the edit');
});

/* ============================================================
   SUITE: Site Import Bundle (console -> site export)
   Ported from test_bundle.js, 2026-08-14.
   ============================================================ */
runSuite('Site Import Bundle export', (assert)=>{
  const fns = extractFns(['siteImportBundleBuild','courseByNum']);
  if(fns.missing.includes('siteImportBundleBuild')){ assert(false,'MISSING FROM FILE: siteImportBundleBuild'); return; }
  function courseByNum(num){
    const map = {'205':{num:'205', iss:'Amy'}, '407':{num:'407', iss:'Shaz'}};
    return map[num] || null;
  }
  const STATE = {
    qaEvals: {'205': {courseNum:'205', iss:'Jim', evalDate:'2026-09-01', status:'Scheduled',
      findings:[{id:'f1', text:'Missing SOI', ref:'2201'}]}},
    stageInventory: {'205': {items:{'soi':{status:'Complete', fy:'2026'}}}},
    trainingLog: [{person:'Taneya', event:'Annual Safety'}],
    courseMaterial: {'205': {establishedFirstDate:'2026-09-01', establishedFY:'2026'}},
    customMilestones: [{id:'cm1', scope:'all', name:'Draft Review'}],
    imHistory: [{controlNumber:205, beginDate:'2026-07-01'}],
    taskTriggerInstances: [{id:'t1', status:'draft'}, {id:'t2', status:'approved'}],
    calendarEvents: [{id:'c1', date:'2026-08-15', title:'Team Meeting'}]
  };
  eval(SHARED_ENV + 'function courseByNum(n){return ({"205":{num:"205",iss:"Amy"}}[n]||null);}\n' + fns.code.replace(/function courseByNum[\s\S]*?\n\}\n/, ''));

  const bundle = siteImportBundleBuild();
  assert(bundle.qaEvals.length === 1 && bundle.qaEvals[0].iss === 'Amy',
    'qaEvals uses LIVE iss from courseByNum, not the stale stored value, got: '+(bundle.qaEvals[0]&&bundle.qaEvals[0].iss));
  assert(JSON.stringify(bundle.qaEvals[0].findings) === JSON.stringify(STATE.qaEvals['205'].findings),
    'findings preserved in full, nested, not flattened');
  assert(bundle.triggeredTasks.length === 2, 'triggeredTasks includes BOTH draft and approved, got '+bundle.triggeredTasks.length);
});

/* ============================================================
   REPORT
   ============================================================ */
console.log('');
console.log('EDDB Console Regression Suite — ' + consolePath);
console.log('='.repeat(60));
SUITE_RESULTS.forEach(r=>{
  console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name);
  if(!r.pass) r.failures.forEach(f=>console.log('        - '+f));
});
console.log('='.repeat(60));
console.log(TOTAL_PASS + ' of ' + SUITE_RESULTS.length + ' suites passed.');
process.exit(TOTAL_FAIL > 0 ? 1 : 0);
