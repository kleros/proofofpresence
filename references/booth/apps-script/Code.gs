/**
 * Kleros Devcon booth: lead database on Google Sheets.
 *
 * Setup (see README.md for the full walkthrough):
 *   1. Create a Google Sheet, then Extensions > Apps Script.
 *   2. Paste the output of scripts/apps-script-bundle.sh (site/matching.js + this file) into the editor.
 *   3. Run `setup` once (authorise when asked). It builds every tab below
 *      and prints the dashboard / agent key in the execution log.
 *   4. Deploy > New deployment > Web app: Execute as "Me", Access "Anyone".
 *   5. Put the /exec URL in config.js.
 *
 * Tabs built by setup():
 *   Read me          what everything means
 *   Leads            master table, one row per person (the only tab anyone writes to)
 *   Hot leads        "Connect with the Kleros team" requests (site/connect.html), for the team to follow up
 *   Priority queue   everyone, best leads first
 *   By pipeline      one block per Kleros track (focus pipelines first), then Other
 *   By level         Decision-maker / Influencer / Practitioner / Community
 *   Flags            leads where research found something worth acting on
 *   Research queue   leads still waiting for background research
 *   Dashboard        counts by pipeline x level, priority, research progress
 *   Agent log        every write made by a research agent
 *
 * HTTP API (all reads/writes except check-in need ?key= / "key"):
 *   POST {check-in payload}                        booth form check-in (no key)
 *   GET  ?key=K                                    all leads (dashboard)
 *   GET  ?key=K&action=merch&id=ID&value=true      mark merch given (id = Client ID; ticket=T also works)
 *   GET  ?key=K&action=queue[&limit=N]             leads with Research status = Pending
 *   POST {action:'enrich', key, ticket, agent, fields:{...}}   research agent write-back
 *   POST {action:'verify', id[, steps, tg]}        page polls: blog subscription confirmed? merch tier, Telegram,
 *                                                  already claimed. Also records the page's merch steps.
 *   POST ?hook=ghost&secret=S {Ghost webhook}      Ghost: member.added / member.edited (see "blog gate")
 *   POST {action:'connect', rid, name, company, email, topics, project, …}   Connect page → Hot leads tab
 */

// Drive folder the database lives in ("Kleros Booth Check-in · Devcon 2026" in the work Drive).
// As a standalone project, the first run creates the Sheet there and remembers its id;
// as a bound script it uses the Sheet it's attached to.
var FOLDER_ID = '148P7gwxk7GcChF9d978jq1NwKlNk8rRe';

var LEADS = 'Leads';
// Devcon's local time, so check-in times read right at the booth. Change with the Devcon city.
var TIME_ZONE = 'Asia/Kolkata';
// Pre-formatted rows in Leads. Devcon can bring up to ~10,000 check-ins; check-ins add more rows if this fills up.
var CAPACITY = 10000;
var LOG = 'Agent log';

// Column groups. Order here is the column order in the sheet.
var GROUPS = [
  { name: 'Who they are', color: '#4d00b4', cols: [
    'Ticket', 'Checked in at', 'Name', 'Company', 'Role', 'Seniority',
    'Email', 'Telegram', 'LinkedIn', 'X'] },
  { name: 'What they told us', color: '#6b2fa8', cols: [
    'Interests', 'Other interest', 'Kleros use case idea', 'Working on', 'Wants call', 'Newsletter'] },
  { name: 'Kleros fit (automatic)', color: '#9013fe', cols: [
    'Pipeline', 'Primary use case', 'Secondary use case', 'Level', 'Fit score', 'Priority',
    'Suggested product', 'Owner', 'Next step', 'Match reasons'] },
  { name: 'Background research (agents)', color: '#0b6b5c', cols: [
    'Research status', 'Researched at', 'Researched by', 'Confidence',
    'Verified title', 'Company summary', 'Company stage', 'Funding & backers', 'Ecosystems',
    'Relevance to Kleros', 'Flag type', 'Flags', 'Sources'] },
  { name: 'Team follow-up', color: '#7a5200', cols: [
    'Status', 'Assigned to', 'Last contact', 'Team notes', 'Merch given', 'Returning visitor'] },
  { name: 'System', color: '#55565a', cols: [
    'Priority rank', 'Level rank', 'Source', 'Event', 'Client ID'] },
  // Last on purpose: added for merch tiers, after the Sheet was live (addMerchTierColumns).
  { name: 'Merch tier', color: '#8a6200', cols: [
    'Tier', 'Claim', 'Telegram check', 'Telegram account', 'Telegram ID',
    'Followed X', 'Followed LinkedIn', 'Kleros 101', 'Quiz wrong picks', 'Steps updated'] }
];

var HEADERS = [];
GROUPS.forEach(function (g) { HEADERS = HEADERS.concat(g.cols); });

// Only these columns may be written by research agents.
var RESEARCH_COLS = GROUPS[3].cols;

var LISTS = {
  'Research status': ['Pending', 'In progress', 'Done', 'Needs human', 'Skip'],
  'Confidence': ['High', 'Medium', 'Low'],
  'Flag type': ['Partnership', 'Integration', 'Enterprise deal', 'Investor', 'Speaker / content', 'AI juror operator',
                'Hiring / talent', 'Media', 'Competitor', 'Risk', 'None'],
  'Status': ['New', 'Contacted', 'Call booked', 'In discussion', 'Integrating', 'Not a fit'],
  'Company stage': ['Idea / pre-seed', 'Seed', 'Series A+', 'Public / large enterprise', 'DAO / protocol',
                    'Government / institution', 'University / research', 'Independent', 'Unknown']
};

function col_(name) { return HEADERS.indexOf(name) + 1; }

function letter_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

var ss__ = null;
function ss_() {
  if (ss__) return ss__;
  ss__ = SpreadsheetApp.getActiveSpreadsheet();
  if (ss__) return ss__;
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SHEET_ID');
  if (id) return (ss__ = SpreadsheetApp.openById(id));
  ss__ = SpreadsheetApp.create(SHEET_NAME);
  DriveApp.getFileById(ss__.getId()).moveTo(DriveApp.getFolderById(FOLDER_ID));
  props.setProperty('SHEET_ID', ss__.getId());
  return ss__;
}
function sheet_(name) { return ss_().getSheetByName(name) || ss_().insertSheet(name); }

/* ---------------------------------------------------------------- setup */

function setup() {
  buildLeads_();
  setTimeZone();
  buildViews_();
  buildDashboard_();
  buildLog_();
  buildReadme_();
  tidyDrive_();
  // Drop the default empty tab and put the tabs in reading order.
  hotSheet_();
  var order = ['Read me', LEADS, HOT, 'Priority queue', 'By pipeline', 'By level', 'Flags', 'Research queue', 'Dashboard', LOG];
  ss_().getSheets().forEach(function (sh) { if (order.indexOf(sh.getName()) < 0 && ss_().getSheets().length > 1) ss_().deleteSheet(sh); });
  order.forEach(function (name, i) { ss_().setActiveSheet(sheet_(name)); ss_().moveActiveSheet(i + 1); });
  ss_().setActiveSheet(sheet_(LEADS));
  // Standalone projects don't get onOpen for free; install it once so the Kleros menu shows in the Sheet.
  var hasOpen = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'onOpen'; });
  if (!hasOpen) ScriptApp.newTrigger('onOpen').forSpreadsheet(ss_()).onOpen().create();
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ADMIN_KEY')) props.setProperty('ADMIN_KEY', Utilities.getUuid().slice(0, 13));
  Logger.log('Dashboard / agent key: ' + props.getProperty('ADMIN_KEY'));
}

// Name the Sheet and keep this backend project in the same Drive folder as the Sheet.
var SHEET_NAME = 'Kleros Devcon 2026 \u00b7 Booth Leads Database';
function tidyDrive_() {
  ss_().rename(SHEET_NAME);
  var folder = DriveApp.getFileById(ss_().getId()).getParents();
  if (!folder.hasNext()) return;
  var f = folder.next();
  var script = DriveApp.getFileById(ScriptApp.getScriptId());
  var inFolder = false, ps = script.getParents();
  while (ps.hasNext()) if (ps.next().getId() === f.getId()) inFolder = true;
  if (!inFolder) script.moveTo(f);
}

function buildLeads_() {
  var sh = sheet_(LEADS);
  // New tabs only have 26 columns and 1,000 rows; size the table for every header and CAPACITY leads.
  if (sh.getMaxColumns() < HEADERS.length) sh.insertColumnsAfter(sh.getMaxColumns(), HEADERS.length - sh.getMaxColumns());
  if (sh.getMaxRows() < CAPACITY + 2) sh.insertRowsAfter(sh.getMaxRows(), CAPACITY + 2 - sh.getMaxRows());
  // Row 1: group bands. Row 2: headers. Data from row 3.
  var c = 1;
  GROUPS.forEach(function (g) {
    // Coloured band without merging, so the first columns can stay frozen.
    var r = sh.getRange(1, c, 1, g.cols.length);
    r.breakApart().setBackground(g.color).setFontColor('#ffffff').setFontWeight('bold');
    sh.getRange(1, c).setValue(g.name);
    sh.getRange(2, c, 1, g.cols.length).setValues([g.cols]).setBackground(g.color).setFontColor('#ffffff').setFontWeight('bold');
    c += g.cols.length;
  });
  sh.setFrozenRows(2);
  sh.setFrozenColumns(3);
  sh.getRange(2, 1, 1, HEADERS.length).setWrap(true).setVerticalAlignment('middle');

  var n = sh.getMaxRows() - 2;
  Object.keys(LISTS).forEach(function (h) {
    sh.getRange(3, col_(h), n, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(LISTS[h], true).setAllowInvalid(true).build());
  });
  sh.getRange(3, col_('Merch given'), n, 1).insertCheckboxes();
  sh.setConditionalFormatRules(formatRules_(sh));

  var widths = { 'Name': 160, 'Company': 160, 'Next step': 280, 'Match reasons': 220, 'Company summary': 260,
                 'Relevance to Kleros': 260, 'Flags': 240, 'Sources': 220, 'Team notes': 220, 'Kleros use case idea': 220 };
  HEADERS.forEach(function (h, i) { sh.setColumnWidth(i + 1, widths[h] || 120); });
  // System columns are for formulas and code; keep them out of the way.
  sh.hideColumns(col_('Priority rank'), GROUPS[5].cols.length);
}

// Every colour rule on Leads (setting them replaces the old set, so this is safe to re-apply).
function formatRules_(sh) {
  var n = sh.getMaxRows() - 2;
  var rng = function (h) { return sh.getRange(3, col_(h), n, 1); };
  var rule = function (h, text, bg, fg) {
    return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(text).setBackground(bg).setFontColor(fg).setRanges([rng(h)]).build();
  };
  return [
    rule('Priority', 'Hot', '#ffd6e0', '#9b0034'),
    rule('Priority', 'Warm', '#fff1cc', '#7a5200'),
    rule('Priority', 'Nurture', '#e6f7f4', '#0b6b5c'),
    rule('Level', 'Decision-maker', '#efe3ff', '#4d00b4'),
    rule('Wants call', 'Yes', '#ffd6e0', '#9b0034'),
    rule('Research status', 'Pending', '#f1f1f4', '#55565a'),
    rule('Research status', 'Needs human', '#fff1cc', '#7a5200'),
    SpreadsheetApp.newConditionalFormatRule().whenCellNotEmpty().setBackground('#fff1cc').setFontColor('#7a5200').setRanges([rng('Flags')]).build(),
    rule('Tier', 'Gold', '#fbe7b5', '#7a5200'),
    rule('Tier', 'Purple', '#efe3ff', '#4d00b4'),
    rule('Tier', 'Teal', '#dcf7f2', '#0b6b5c'),
    rule('Claim', 'Already claimed', '#ffd6e0', '#9b0034')
  ];
}

/** One-off for a Sheet made before merch tiers: adds the Merch tier columns after System. Safe to run again. */
function addMerchTierColumns() {
  var sh = sheet_(LEADS);
  if (sh.getMaxColumns() < HEADERS.length) sh.insertColumnsAfter(sh.getMaxColumns(), HEADERS.length - sh.getMaxColumns());
  var g = GROUPS[GROUPS.length - 1], c = col_(g.cols[0]);
  sh.showColumns(c, g.cols.length);   // new columns can inherit "hidden" from the System column before them
  sh.getRange(1, c, 1, g.cols.length).setBackground(g.color).setFontColor('#ffffff').setFontWeight('bold');
  sh.getRange(1, c).setValue(g.name);
  sh.getRange(2, c, 1, g.cols.length).setValues([g.cols]).setBackground(g.color).setFontColor('#ffffff').setFontWeight('bold')
    .setWrap(true).setVerticalAlignment('middle');
  sh.setColumnWidths(c, g.cols.length, 120);
  sh.setConditionalFormatRules(formatRules_(sh));
  buildDashboard_();
}

// Columns every view shows, in this order.
var VIEW_COLS = ['Ticket', 'Name', 'Company', 'Role', 'Seniority', 'Level', 'Pipeline', 'Primary use case',
                 'Priority', 'Fit score', 'Wants call', 'Next step', 'Owner', 'Flag type', 'Flags',
                 'Research status', 'Status', 'Email', 'Telegram', 'LinkedIn'];

function viewSelect_() {
  return VIEW_COLS.map(function (h) { return letter_(col_(h)); }).join(', ');
}

function leadsRange_() {
  return "'" + LEADS + "'!A3:" + letter_(HEADERS.length);
}

function query_(where, order, limit) {
  return '=IFERROR(QUERY(' + leadsRange_() + ', "select ' + viewSelect_() + ' where ' + where +
    (order ? ' order by ' + order : '') + (limit ? ' limit ' + limit : '') + '", 0), "Nothing here yet")';
}

// Per-section cap on the stacked views (By pipeline, By level). Priority queue and Leads hold everyone.
var SECTION_LIMIT = 100;
function countNote_(col, value, label) {
  return '="' + label + ' · " & COUNTIF(' + "'" + LEADS + "'!" + L_(col) + '3:' + L_(col) + ',"' + value + '") & " leads (best ' + SECTION_LIMIT + ' shown; filter Priority queue for all)"';
}

function header_(sh, row, title, note) {
  sh.getRange(row, 1).setValue(title).setFontWeight('bold').setFontSize(12).setFontColor('#4d00b4');
  if (note) sh.getRange(row, 2).setValue(note).setFontColor('#55565a');
  sh.getRange(row + 1, 1, 1, VIEW_COLS.length).setValues([VIEW_COLS]).setFontWeight('bold').setBackground('#efe3ff');
}

function L_(h) { return letter_(col_(h)); }

// Every Kleros track from Matching.gs, focus pipelines first, then the catch-all.
function pipelines_() { return KLEROS_USE_CASES.map(function (u) { return u.short; }).concat(['Other']); }
var BEST_FIRST = '';

function buildViews_() {
  BEST_FIRST = L_('Priority rank') + ' asc, ' + L_('Level rank') + ' asc, ' + L_('Fit score') + ' desc';
  var notEmpty = L_('Ticket') + " is not null";

  var pq = sheet_('Priority queue'); pq.clear();
  header_(pq, 1, 'Priority queue', 'Hot first, then decision-makers, then fit score. Read-only: edit in Leads.');
  pq.getRange(3, 1).setFormula(query_(notEmpty, BEST_FIRST));
  pq.setFrozenRows(2);

  // Fixed-size blocks: each section shows its best SECTION_LIMIT leads, so sections never overlap.
  var BLOCK = SECTION_LIMIT;
  var bp = sheet_('By pipeline'); bp.clear();
  pipelines_().forEach(function (p, i) {
    var r = 1 + i * (BLOCK + 3);
    var uc = KLEROS_USE_CASES.filter(function (u) { return u.short === p; })[0];
    header_(bp, r, p, '');
    bp.getRange(r, 2).setFormula(countNote_('Pipeline', p, uc ? (uc.focus ? 'Focus pipeline · ' : '') + uc.product : 'No clear signal yet'));
    bp.getRange(r + 2, 1).setFormula(query_(L_('Pipeline') + " = '" + p + "'", BEST_FIRST, SECTION_LIMIT));
  });

  var bl = sheet_('By level'); bl.clear();
  ['Decision-maker', 'Influencer', 'Practitioner', 'Community'].forEach(function (lv, i) {
    var r = 1 + i * (BLOCK + 3);
    header_(bl, r, lv, '');
    bl.getRange(r, 2).setFormula(countNote_('Level', lv, { 'Decision-maker': 'Founders, C-suite, VPs and heads', 'Influencer': 'Managers, senior BD/product',
      'Practitioner': 'Individual contributors', 'Community': 'Students and community' }[lv]));
    bl.getRange(r + 2, 1).setFormula(query_(L_('Level') + " = '" + lv + "'", BEST_FIRST, SECTION_LIMIT));
  });

  var fl = sheet_('Flags'); fl.clear();
  header_(fl, 1, 'Flags', 'Research found something worth acting on.');
  fl.getRange(3, 1).setFormula(query_(L_('Flags') + " is not null", BEST_FIRST));

  var rq = sheet_('Research queue'); rq.clear();
  header_(rq, 1, 'Research queue', 'Waiting for background research. Agents work top to bottom.');
  rq.getRange(3, 1).setFormula(query_(L_('Research status') + " = 'Pending' or " + L_('Research status') + " = 'In progress'", BEST_FIRST));
}

function buildDashboard_() {
  hotSheet_();   // the Hot leads count below reads it
  var sh = sheet_('Dashboard'); sh.clear();
  var lr = "'" + LEADS + "'!";
  var colRef = function (h) { return lr + L_(h) + '3:' + L_(h); };
  sh.getRange('A1').setValue('Kleros at Devcon VIII · lead dashboard').setFontWeight('bold').setFontSize(14).setFontColor('#4d00b4');

  var kpis = [
    ['Check-ins', '=COUNTA(' + colRef('Ticket') + ')'],
    ['Hot', '=COUNTIF(' + colRef('Priority') + ',"Hot")'],
    ['Decision-makers', '=COUNTIF(' + colRef('Level') + ',"Decision-maker")'],
    ['Want a call', '=COUNTIF(' + colRef('Wants call') + ',"Yes")'],
    ['Hot leads (Connect form)', "=COUNTA('" + HOT + "'!A2:A)"],
    ['Flagged by research', '=COUNTIF(' + colRef('Flags') + ',"<>")'],
    ['Research pending', '=COUNTIF(' + colRef('Research status') + ',"Pending")'],
    ['Merch given', '=COUNTIF(' + colRef('Merch given') + ',TRUE)'],
    ['Teal tier', '=COUNTIF(' + colRef('Tier') + ',"Teal")'],
    ['Purple tier', '=COUNTIF(' + colRef('Tier') + ',"Purple")'],
    ['Gold tier', '=COUNTIF(' + colRef('Tier') + ',"Gold")'],
    ['Joined Telegram', '=COUNTIF(' + colRef('Telegram check') + ',"Joined")'],
    ['Already claimed', '=COUNTIF(' + colRef('Claim') + ',"Already claimed")']
  ];
  sh.getRange(3, 1, kpis.length, 2).setValues(kpis);
  sh.getRange(3, 1, kpis.length, 1).setFontWeight('bold');

  var pipes = pipelines_();
  var levels = ['Decision-maker', 'Influencer', 'Practitioner', 'Community'];
  var top = 3 + kpis.length + 2;
  sh.getRange(top, 1).setValue('Pipeline × level').setFontWeight('bold').setFontColor('#4d00b4');
  sh.getRange(top + 1, 1, 1, levels.length + 3).setValues([['Pipeline'].concat(levels).concat(['Total', 'Hot'])])
    .setFontWeight('bold').setBackground('#efe3ff');
  pipes.forEach(function (p, i) {
    var row = [p];
    levels.forEach(function (lv) {
      row.push('=COUNTIFS(' + colRef('Pipeline') + ',"' + p + '",' + colRef('Level') + ',"' + lv + '")');
    });
    row.push('=COUNTIF(' + colRef('Pipeline') + ',"' + p + '")');
    row.push('=COUNTIFS(' + colRef('Pipeline') + ',"' + p + '",' + colRef('Priority') + ',"Hot")');
    sh.getRange(top + 2 + i, 1, 1, row.length).setValues([row]);
  });
  sh.setColumnWidth(1, 180);
}

function buildLog_() {
  var sh = sheet_(LOG);
  sh.getRange(1, 1, 1, 6).setValues([['Time', 'Agent', 'Ticket', 'Action', 'Fields written', 'Notes']])
    .setFontWeight('bold').setBackground('#0b6b5c').setFontColor('#ffffff');
  sh.setFrozenRows(1);
}

function buildReadme_() {
  var sh = sheet_('Read me'); sh.clear();
  var rows = [
    ['Kleros at Devcon VIII · lead database'],
    [''],
    ['How data gets here'],
    ['1. A visitor scans the booth QR and checks in. The page posts to this Sheet (Apps Script web app).'],
    ['2. A new row lands in Leads. Kleros fit is filled in automatically from matching (Matching.gs).'],
    ['3. Research status starts as Pending. Research agents pick rows from Research queue, look the person and company up, and write the Background research columns.'],
    ['4. The team works from Priority queue / By pipeline / Flags and updates Team follow-up.'],
    [''],
    ['Priority'],
    ['Hot: in a focus pipeline (AI agents, Prediction markets, Enterprise, DeFi curation) and asked for a call, or clear topic fit plus decision power.'],
    ['Warm: topic fit, or a senior person. Nurture: community, students, newsletter only.'],
    [''],
    ['Level (from Seniority + Role)'],
    ['Decision-maker: founders, C-suite, VP/Head/Director. Influencer: managers, senior BD/product. Practitioner: individual contributors. Community: students.'],
    [''],
    ['Rules'],
    ['Edit only the Leads tab, and in Hot leads the Follow-up owner, Status and Team notes. Every other tab is a formula view and refreshes by itself.'],
    ['Hot leads: people who tapped "Connect with the Kleros team" and asked for a follow-up. If they also checked in, their Leads row says Wants call = Yes.'],
    ['Agents write only the Background research columns, and log every write in Agent log.'],
    ['Research uses public professional information only (company sites, LinkedIn headline, press, GitHub, X). No personal life, no sensitive data.'],
    ['Delete the whole row if someone asks to be removed.'],
    [''],
    ['Kleros menu: Re-run matching after editing Matching.gs · Rebuild views if a tab was deleted · Show key.']
  ];
  sh.getRange(1, 1, rows.length, 1).setValues(rows).setWrap(true);
  sh.setColumnWidth(1, 900);
  [1, 3, 9, 13, 16].forEach(function (r) { sh.getRange(r, 1).setFontWeight('bold').setFontColor('#4d00b4'); });
  sh.getRange(1, 1).setFontSize(14);
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Kleros')
    .addItem('Re-run use-case matching', 'rematchAll')
    .addItem('Rebuild views & dashboard', 'rebuildViews')
    .addItem('Show dashboard / agent key', 'showKey')
    .addSeparator()
    .addItem('Load example rows', 'loadExamples')
    .addItem('Delete example & test rows', 'deleteExamples')
    .addToUi();
}

function rebuildViews() { buildViews_(); buildDashboard_(); }

// Sheet clock in Devcon's local time, and check-in times shown with the hour.
function setTimeZone() {
  ss_().setSpreadsheetTimeZone(TIME_ZONE);
  var sh = sheet_(LEADS);
  sh.getRange(3, col_('Checked in at'), sh.getMaxRows() - 2, 1).setNumberFormat('d mmm yyyy, hh:mm');
}

function showKey() {
  SpreadsheetApp.getUi().alert('Dashboard / agent key: ' + PropertiesService.getScriptProperties().getProperty('ADMIN_KEY'));
}

/* ------------------------------------------------------------------ API */

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function authorised_(key) {
  return key && key === PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
}

// Guard clauses: require_(condition, error) stops the request, and respond_ answers { ok: false, error }.
function RequireError_(message) { this.message = message; }
function require_(condition, error) {
  if (!condition) throw new RequireError_(error);
}

// Runs a request handler. A failed require_ comes back as its error; anything unexpected (a lock timeout,
// a Sheets hiccup) as its details, so the page keeps the check-in queued and retries.
function respond_(handler) {
  try { return handler(); }
  catch (err) { return json_({ ok: false, error: err instanceof RequireError_ ? err.message : String(err) }); }
}

// Last row holding a lead. Based on the Ticket column, because the Merch checkboxes make Google treat every
// pre-formatted row as "used". Ctrl+Up from the bottom of that column: one lookup however many rows are
// pre-formatted (reading the whole column took ~3 s per call with 10,000 rows).
function lastRow_(sh) {
  var bottom = sh.getRange(sh.getMaxRows(), col_('Ticket'));
  if (bottom.getValue() !== '') return bottom.getRow();   // table filled to the very last row
  return Math.max(2, bottom.getNextDataCell(SpreadsheetApp.Direction.UP).getRow());
}

function findRow_(sh, header, value) {
  var last = lastRow_(sh);
  if (last < 3) return -1;
  var vals = sh.getRange(3, col_(header), last - 2, 1).getValues();
  for (var i = 0; i < vals.length; i++) if (String(vals[i][0]) === String(value)) return i + 3;
  return -1;
}

// Like findRow_, but the most recent match.
function findLastRow_(sh, header, value) {
  var last = lastRow_(sh);
  if (last < 3) return -1;
  var vals = sh.getRange(3, col_(header), last - 2, 1).getValues();
  for (var i = vals.length - 1; i >= 0; i--) if (String(vals[i][0]) === String(value)) return i + 3;
  return -1;
}

function fitColumns_(m) {
  return [m.pipeline, m.primary, m.secondary, m.level, m.fitScore, m.priority, m.product, m.owner, m.nextStep, m.reasons];
}

function doPost(e) {
  return respond_(function () {
    var p = e.parameter || {};
    if (p.hook === 'ghost') return ghostHook_(e, p);
    var d = body_(e);
    if (d.member && !d.action) hookLog_({ result: 'Ghost payload without ?hook=ghost', params: Object.keys(p) });
    // Polled every few seconds by visitors confirming their email; it only reads (plus one cell), so no write lock.
    if (d.action === 'verify') return verify_(d);
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);   // a busy timeout throws: respond_ answers with it and the page retries
    try {
      return d.action === 'enrich' ? enrich_(d) : d.action === 'connect' ? connect_(d) : checkIn_(d);
    } finally {
      lock.releaseLock();
    }
  });
}

function body_(e) {
  var d = null;
  try { d = JSON.parse(e.postData.contents); } catch (err) { /* reported just below */ }
  require_(d && typeof d === 'object', 'bad request');
  return d;
}

// Visitor text as a plain cell: capped in length, and never read as a formula ("=IMPORTXML(...)" stays text).
function text_(v) {
  v = String(v == null ? '' : v).slice(0, 1000);
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

/** Booth check-in. Idempotent on client id. */
function checkIn_(d) {
  // Reject anything that isn't a real form submission (the form always sends these).
  require_(d.id && d.ticket && d.name && d.company, 'invalid check-in');
  var sh = sheet_(LEADS);
  if (findRow_(sh, 'Client ID', d.id) > 0) return json_({ ok: true, duplicate: true });
  var returning = !!d.email && findRow_(sh, 'Email', d.email) > 0;

  var m = matchLead({ company: d.company, position: d.position, seniority: d.seniority, interests: d.interests || [],
    building: d.building, otherInterest: d.otherInterest, klerosUse: d.klerosUse, wantsCall: d.wantsCall });

  var v = {};
  var ts = d.ts ? new Date(d.ts) : new Date();
  v['Ticket'] = text_(d.ticket); v['Checked in at'] = isNaN(ts) ? new Date() : ts;
  v['Name'] = text_(d.name); v['Company'] = text_(d.company); v['Role'] = text_(d.position); v['Seniority'] = text_(d.seniority);
  v['Email'] = text_(d.email); v['Telegram'] = d.telegram ? text_('@' + d.telegram) : ''; v['LinkedIn'] = text_(d.linkedin); v['X'] = d.x ? text_('@' + d.x) : '';
  v['Interests'] = text_((d.interests || []).join(', ')); v['Other interest'] = text_(d.otherInterest);
  v['Kleros use case idea'] = text_(d.klerosUse); v['Working on'] = text_(d.building);
  v['Wants call'] = d.wantsCall ? 'Yes' : 'No'; v['Newsletter'] = d.newsletter ? 'Yes' : 'No';
  var fit = fitColumns_(m);
  GROUPS[2].cols.forEach(function (h, i) { v[h] = fit[i]; });
  v['Research status'] = 'Pending';
  v['Status'] = 'New'; v['Merch given'] = false; v['Returning visitor'] = returning ? 'Yes' : '';
  v['Priority rank'] = m.priorityRank; v['Level rank'] = m.levelRank;
  v['Source'] = text_(d.source); v['Event'] = text_(d.event); v['Client ID'] = text_(d.id);

  var row = lastRow_(sh) + 1;
  // Setup gives CAPACITY rows their Merch checkbox; rows added past that get theirs here.
  if (row > sh.getMaxRows()) { sh.insertRowsAfter(sh.getMaxRows(), 1000); sh.getRange(row, col_('Merch given'), 1000, 1).insertCheckboxes(); }
  sh.getRange(row, 1, 1, HEADERS.length).setValues([HEADERS.map(function (h) { return v.hasOwnProperty(h) ? v[h] : ''; })]);
  return json_({ ok: true, ticket: d.ticket });
}

/** Research agent write-back: only Background research columns, always logged. */
function enrich_(d) {
  require_(authorised_(d.key), 'unauthorised');
  var sh = sheet_(LEADS);
  var row = findRow_(sh, 'Ticket', d.ticket);
  require_(row > 0, 'ticket not found');
  var fields = d.fields || {};
  var written = [];
  Object.keys(fields).forEach(function (h) {
    if (RESEARCH_COLS.indexOf(h) < 0) return;   // ignore anything outside the research group
    sh.getRange(row, col_(h)).setValue(typeof fields[h] === 'string' ? text_(fields[h]) : fields[h]);
    written.push(h);
  });
  if (!fields['Researched at']) { sh.getRange(row, col_('Researched at')).setValue(new Date()); written.push('Researched at'); }
  if (d.agent && !fields['Researched by']) { sh.getRange(row, col_('Researched by')).setValue(d.agent); written.push('Researched by'); }
  sheet_(LOG).appendRow([new Date(), d.agent || '', d.ticket, 'enrich', written.join(', '), d.note || '']);
  return json_({ ok: true, written: written });
}

function rowsAsObjects_(sh, filterFn, limit) {
  var last = lastRow_(sh);
  if (last < 3) return [];
  var values = sh.getRange(3, 1, last - 2, HEADERS.length).getValues();
  var out = [];
  for (var i = 0; i < values.length && (!limit || out.length < limit); i++) {
    var o = {};
    HEADERS.forEach(function (h, k) { var x = values[i][k]; o[h] = x instanceof Date ? x.toISOString() : x; });
    if (o['Ticket'] && (!filterFn || filterFn(o))) out.push(o);
  }
  return out;
}

function doGet(e) {
  return respond_(function () { return get_(e.parameter || {}); });
}

function get_(p) {
  require_(authorised_(p.key), 'unauthorised');
  var sh = sheet_(LEADS);

  if (p.action === 'merch' && (p.id || p.ticket)) {
    // By client id when the dashboard sends it, so a repeated ticket code can't mark the wrong person.
    var row = p.id ? findRow_(sh, 'Client ID', p.id) : -1;
    if (row < 0 && p.ticket) row = findRow_(sh, 'Ticket', p.ticket);
    require_(row > 0, 'ticket not found');
    var giving = p.value !== 'false';
    require_(!giving || sh.getRange(row, col_('Claim')).getValue() !== 'Already claimed',
      'Already claimed: this email or Telegram account got merch on another check-in.');
    // Merch only once the visitor has confirmed their blog subscription, as Ghost reported it, so it never
    // depends on what the visitor's page shows.
    if (giving && gateOn_() && sh.getRange(row, col_('Newsletter')).getValue() === 'Yes') {
      require_(ghostSecret_(), 'The blog check is not set up yet (run ghostWebhookSetup and add the webhooks in Ghost).');
      require_(blogConfirmed_(sh.getRange(row, col_('Email')).getValue()),
        'Email not confirmed yet. Ask them to tap the link in the Kleros blog email, then try again.');
      sh.getRange(row, col_('Newsletter')).setValue('Confirmed');
    }
    sh.getRange(row, col_('Merch given')).setValue(giving);
    return json_({ ok: true });
  }

  if (p.action === 'queue') {
    var queue = rowsAsObjects_(sh, function (o) { return o['Research status'] === 'Pending'; });
    queue.sort(function (a, b) { return (a['Priority rank'] - b['Priority rank']) || (a['Level rank'] - b['Level rank']) || (b['Fit score'] - a['Fit score']); });
    return json_({ ok: true, rows: queue.slice(0, Number(p.limit) || 25), researchColumns: RESEARCH_COLS, lists: LISTS });
  }

  return json_({ ok: true, rows: rowsAsObjects_(sh) });
}

// Matching for one Leads row's values (a row from getValues).
function matchRow_(r) {
  var g = function (h) { return r[col_(h) - 1]; };
  return matchLead({ company: g('Company'), position: g('Role'), seniority: g('Seniority'),
    interests: String(g('Interests') || ''), building: g('Working on'), otherInterest: g('Other interest'),
    klerosUse: g('Kleros use case idea'), wantsCall: g('Wants call') });
}

/** Menu action: recompute matching for every row after tuning Matching.gs. */
function rematchAll() {
  var sh = sheet_(LEADS);
  var last = lastRow_(sh);
  if (last < 3) return;
  var data = sh.getRange(3, 1, last - 2, HEADERS.length).getValues();
  var fit = [], ranks = [];
  data.forEach(function (r) {
    var m = matchRow_(r);
    fit.push(fitColumns_(m));
    ranks.push([m.priorityRank, m.levelRank]);
  });
  sh.getRange(3, col_('Pipeline'), fit.length, fit[0].length).setValues(fit);
  sh.getRange(3, col_('Priority rank'), ranks.length, 2).setValues(ranks);
}

/* ------------------------------------------------------------ hot leads */

// "Connect with the Kleros team" (site/connect.html): people who want a real follow-up, not just merch. One row
// each in the Hot leads tab, for the team to work through. If they also checked in with the same email, that
// Leads row gets Wants call = Yes and fresh matching, so it shows as Hot in every view and on the dashboard.
var HOT = 'Hot leads';
var HOT_HEADERS = ['Sent at', 'Name', 'Company', 'Role', 'Email', 'Telegram', 'LinkedIn', 'Wants to talk about', 'Their project',
  'Timing', 'Reach them by', 'Talked to at the booth', 'Check-in ticket', 'Follow-up owner', 'Status', 'Team notes', 'Request ID'];

function hotSheet_() {
  var sh = sheet_(HOT);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, HOT_HEADERS.length).setValues([HOT_HEADERS]).setFontWeight('bold').setBackground('#efe3ff');
    sh.setFrozenRows(1);
  }
  return sh;
}

function connect_(d) {
  var email = String(d.email || '').trim();
  require_(d.rid && d.name && d.company && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email), 'invalid request');
  var sh = hotSheet_(), last = sh.getLastRow();
  if (last >= 2 && sh.getRange(2, HOT_HEADERS.length, last - 1, 1).getValues().some(function (r) { return String(r[0]) === String(d.rid); })) {
    return json_({ ok: true, duplicate: true });   // the page retrying a request that was already saved
  }
  // Their latest check-in with the same email, if any.
  var leads = sheet_(LEADS), lastLead = lastRow_(leads), row = -1, want = email.toLowerCase();
  if (lastLead >= 3) {
    var emails = leads.getRange(3, col_('Email'), lastLead - 2, 1).getValues();
    for (var i = emails.length - 1; i >= 0 && row < 0; i--) if (String(emails[i][0]).trim().toLowerCase() === want) row = i + 3;
  }
  var ticket = row > 0 ? leads.getRange(row, col_('Ticket')).getValue() : '';
  sh.appendRow([new Date(), text_(d.name), text_(d.company), text_(d.position), text_(email),
    d.telegram ? text_('@' + String(d.telegram).replace(/^@/, '')) : '', text_(d.linkedin), text_((d.topics || []).join(', ')),
    text_(d.project), text_(d.timing), text_(d.reach), text_(d.met), ticket, '', 'New', '', text_(d.rid)]);
  if (row > 0) {
    leads.getRange(row, col_('Wants call')).setValue('Yes');
    var m = matchRow_(leads.getRange(row, 1, 1, HEADERS.length).getValues()[0]);
    leads.getRange(row, col_('Pipeline'), 1, GROUPS[2].cols.length).setValues([fitColumns_(m)]);
    leads.getRange(row, col_('Priority rank'), 1, 2).setValues([[m.priorityRank, m.levelRank]]);
  }
  return json_({ ok: true, ticket: ticket });
}

/* ------------------------------------------------------------ blog gate */

// The final check-in screen (and merch) only comes once the visitor has confirmed their Kleros blog
// subscription. Ghost tells us through webhooks on a "Devcon booth" custom integration, so we hold no Ghost key
// and never call Ghost:
//   member.added   Ghost creates the member only after they tap "Confirm signup", so this is the confirmation.
//   member.edited  an existing subscriber gets a sign-in email instead; opening the blog from it updates their
//                  "last seen" (once a day), which Ghost reports as an edit.
// Apps Script can't read Ghost's signature header, so the webhook URL carries a secret: GHOST_WEBHOOK_SECRET,
// made by ghostWebhookSetup. Strict on purpose: until it exists nobody gets through.
//
// The switch (Script property BLOG_GATE, flipped by blogGateOff / blogGateOn): "off" means the booth doesn't wait
// for that confirmation. Visitors reach the final screen and merch right after checking in. Only this site's
// waiting step changes: Ghost still emails them and subscribes them only once they tap the link (Kleros's double
// opt-in is untouched), and a webhook confirmation still marks Newsletter = Confirmed.
function gateOn_() {
  return PropertiesService.getScriptProperties().getProperty('BLOG_GATE') !== 'off';
}

function ghostSecret_() {
  return String(PropertiesService.getScriptProperties().getProperty('GHOST_WEBHOOK_SECRET') || '').trim();
}

// The live web app URL (endpoint in site/config.js). Apps Script can't tell a script its own deployment URL.
var WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbzxw7RFUWHJGAD78-9hdmmE4KmNctwLPnpZfD134d_fuoSEQ6MRgKDy7GgWuR9A8D-vzg/exec';

// Ghost webhook (POST ?hook=ghost&secret=S). Only check-ins are written down (Newsletter = Confirmed). Any
// other member's email only sits in the script cache for 6 hours, in case their check-in is still queued on
// their phone, and is never stored. No lock: it reads one column and writes single cells.
function ghostHook_(e, p) {
  // A URL copied out of Slack can keep "&amp;" for "&", which turns the parameter into "amp;secret".
  var secret = ghostSecret_(), given = String(p.secret || p['amp;secret'] || '');
  if (!(secret && given === secret)) hookLog_({ result: 'unauthorised', params: Object.keys(p), givenLength: given.length, secretSet: !!secret });
  require_(secret && given === secret, 'unauthorised');
  var d = body_(e);
  var email = String(((d.member || {}).current || {}).email || '').trim().toLowerCase();
  if (d.event === 'member.deleted' || !email) { hookLog_({ result: 'ignored', event: d.event, email: !!email }); return json_({ ok: true }); }
  CacheService.getScriptCache().put('ghost:' + email, '1', 21600);
  var sh = sheet_(LEADS), last = lastRow_(sh), marked = 0;
  if (last >= 3) {
    var emails = sh.getRange(3, col_('Email'), last - 2, 1).getValues(), news = sh.getRange(3, col_('Newsletter'), last - 2, 1).getValues();
    emails.forEach(function (r, i) {
      if (String(r[0]).trim().toLowerCase() === email && news[i][0] === 'Yes') { sh.getRange(i + 3, col_('Newsletter')).setValue('Confirmed'); marked++; }
    });
  }
  hookLog_({ result: 'ok', event: d.event, checkInsMarked: marked });
  return json_({ ok: true });
}

// The last 10 webhook calls, for ghostWebhookStatus: parameter names and lengths, never the secret or an email.
// (Apps Script keeps no console logs for anonymous web app calls.)
function hookLog_(entry) {
  try {
    var p = PropertiesService.getScriptProperties(), log = JSON.parse(p.getProperty('GHOST_HOOK_LOG') || '[]');
    entry.at = new Date().toISOString();
    log.unshift(entry);
    p.setProperty('GHOST_HOOK_LOG', JSON.stringify(log.slice(0, 10)));
  } catch (err) { /* diagnostics only */ }
}

// Has Ghost reported this email in the last 6 hours? (Rows it matched are already marked Confirmed.)
function blogConfirmed_(email) {
  email = String(email || '').trim().toLowerCase();
  return !!email && CacheService.getScriptCache().get('ghost:' + email) === '1';
}

/**
 * Status of a check-in, polled by the page: has the visitor confirmed their blog subscription (using the email
 * saved with the check-in, never one sent with the request), and once they have, their merch tier, Telegram
 * check and whether this is a second check-in ("Already claimed"). `steps` are the page's merch steps
 * ({ x, linkedin, quiz, wrong }); `tg` says the page is waiting for the Telegram bot.
 */
function verify_(d) {
  var gate = gateOn_();
  var sh = sheet_(LEADS);
  var row = d.id ? findRow_(sh, 'Client ID', d.id) : -1;
  if (row < 0) return json_({ ok: true, confirmed: false, pending: true });   // check-in not saved yet
  // The blog box is optional. Only visitors who ticked it ("Yes", until Ghost confirms) can be kept waiting;
  // "No" never waits, and "Confirmed" is done.
  var news = sh.getRange(row, col_('Newsletter')), asked = news.getValue() === 'Yes';
  if (asked && blogConfirmed_(sh.getRange(row, col_('Email')).getValue())) { news.setValue('Confirmed'); asked = false; }
  if (asked && gate) return json_(ghostSecret_() ? { ok: true, confirmed: false } : { ok: true, confirmed: false, setup: false });
  var m = claim_(sh, row);
  if (m['Claim'] === 'Claimed') {
    var s = d.steps || {}, changes = {};
    if (s.x) changes['Followed X'] = 'Tapped';
    if (s.linkedin) changes['Followed LinkedIn'] = 'Tapped';
    if (s.quiz) { changes['Kleros 101'] = 'Passed'; changes['Quiz wrong picks'] = Math.min(Math.max(Math.floor(Number(s.wrong)) || 0, 0), 99); }
    if (d.tg && m['Telegram check'] !== 'Joined') { var tg = tgConfig_(); if (tg) telegramUpdates_(tg); }
    m = merch_(sh, row, changes);
  }
  var out = status_(m);
  if (asked) out.gate = false;   // the page then says "confirm your subscription in the email" instead of "you're subscribed"
  return json_(out);
}

/* ---------------------------------------------------------- merch tiers */

// Teal: checked in (if they ticked the blog box and BLOG_GATE is on, also confirmed the email). Purple: also
// joined the Kleros Telegram group (checked by the bot) and tapped Follow on X and LinkedIn (counted on tap, not
// checked). Gold: also passed the Kleros 101 quiz on the page. The page shows the tier at the booth; the Sheet
// keeps it for the team.
function tier_(m, newsletter) {
  if ((newsletter === 'Yes' && gateOn_()) || m['Claim'] !== 'Claimed') return '';
  var social = m['Telegram check'] === 'Joined' && m['Followed X'] === 'Tapped' && m['Followed LinkedIn'] === 'Tapped';
  return !social ? 'Teal' : m['Kleros 101'] === 'Passed' ? 'Gold' : 'Purple';
}

// Reads this row's Merch tier columns, applies `changes`, keeps Tier in step, and writes them back in one go.
function merch_(sh, row, changes) {
  var cols = GROUPS[GROUPS.length - 1].cols, rng = sh.getRange(row, col_(cols[0]), 1, cols.length);
  var vals = rng.getValues()[0], m = {}, dirty = false;
  cols.forEach(function (h, i) { m[h] = vals[i]; });
  Object.keys(changes || {}).forEach(function (h) { if (m[h] !== changes[h]) { m[h] = changes[h]; dirty = true; } });
  var tier = tier_(m, sh.getRange(row, col_('Newsletter')).getValue());
  if (tier !== m['Tier']) { m['Tier'] = tier; dirty = true; }
  if (dirty) { m['Steps updated'] = new Date(); rng.setValues([cols.map(function (h) { return m[h]; })]); }
  return m;
}

// One merch per person: the first check-in of an email to reach the final screen claims it. A later check-in
// with the same email (from another phone or browser) gets "Already claimed" instead of a tier. Reopening the
// page on the same phone is the same check-in, so it keeps its tier.
function claim_(sh, row) {
  var m = merch_(sh, row);
  if (m['Claim']) return m;
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var last = lastRow_(sh);
    var emails = sh.getRange(3, col_('Email'), last - 2, 1).getValues(), claims = sh.getRange(3, col_('Claim'), last - 2, 1).getValues();
    if (claims[row - 3][0]) return merch_(sh, row);   // a parallel request got here first
    var email = String(emails[row - 3][0]).trim().toLowerCase();
    var taken = emails.some(function (e, i) { return i !== row - 3 && claims[i][0] === 'Claimed' && String(e[0]).trim().toLowerCase() === email; });
    return merch_(sh, row, { 'Claim': taken ? 'Already claimed' : 'Claimed' });
  } finally {
    lock.releaseLock();
  }
}

var TG_STATE = { 'Joined': 'joined', 'Not joined yet': 'not_member', 'Check failed': 'error' };
function status_(m) {
  if (m['Claim'] === 'Already claimed') {
    return { ok: true, confirmed: true, claimed: m['Telegram check'] === 'Already used' ? 'telegram' : 'email' };
  }
  return { ok: true, confirmed: true, tier: m['Tier'],
    telegram: TG_STATE[m['Telegram check']] || (tgConfig_() ? '' : 'offline'), telegramUser: String(m['Telegram account'] || ''),
    steps: { x: m['Followed X'] === 'Tapped', linkedin: m['Followed LinkedIn'] === 'Tapped', quiz: m['Kleros 101'] === 'Passed' } };
}

/* ------------------------------------------------------------- telegram */

// @KlerosDevconBot checks that a visitor joined the Kleros Telegram group. The page links to
// t.me/KlerosDevconBot?start=<client id>; the visitor taps Start, and the backend reads the bot's new messages
// (getUpdates) whenever a waiting page polls, and every minute from the trigger telegramSetup installs.
// Needs TELEGRAM_BOT_TOKEN in Script properties (from @BotFather) and the bot in the group; Telegram only
// guarantees member lookups to admins (telegramSetup tests it). The token is part of every API URL, so never log a URL.
var TG_MEMBER = ['creator', 'administrator', 'member'];

function tgConfig_() {
  var p = PropertiesService.getScriptProperties();
  var token = String(p.getProperty('TELEGRAM_BOT_TOKEN') || '').trim();
  if (!/^\d+:[\w-]{30,}$/.test(token)) return null;
  var group = String(p.getProperty('TELEGRAM_GROUP') || '@kleros').trim();
  return { token: token, group: group, groupUrl: 'https://t.me/' + group.replace(/^@/, ''),
           site: String(p.getProperty('SITE_URL') || 'https://devcon.kleros.io').trim() };
}

// Bot API call. Failures come back as { ok: false } without the URL, so the token never reaches a response or log.
function tgApi_(cfg, method, payload) {
  try {
    var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + cfg.token + '/' + method,
      { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload || {}), muteHttpExceptions: true });
    return JSON.parse(res.getContentText());
  } catch (err) {
    return { ok: false, description: 'Telegram unreachable' };
  }
}

function tgSay_(cfg, chatId, text, keyboard) {
  tgApi_(cfg, 'sendMessage', keyboard ? { chat_id: chatId, text: text, reply_markup: { inline_keyboard: keyboard } } : { chat_id: chatId, text: text });
}

// Reads the bot's new messages and answers them: one reader at a time, at most every 2 seconds.
function telegramUpdates_(cfg) {
  var cache = CacheService.getScriptCache();
  if (cache.get('tg:read')) return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;   // another request is reading them (or saving a check-in); its turn
  try {
    cache.put('tg:read', '1', 2);
    var props = PropertiesService.getScriptProperties();
    var res = tgApi_(cfg, 'getUpdates', { offset: Number(props.getProperty('TELEGRAM_OFFSET') || 0), limit: 50, timeout: 0,
                                          allowed_updates: ['message', 'callback_query'] });
    if (!res.ok || !res.result.length) return;
    var sh = sheet_(LEADS);
    res.result.forEach(function (u) {
      try { tgUpdate_(cfg, sh, u); } catch (err) { /* one odd message never blocks the rest */ }
    });
    props.setProperty('TELEGRAM_OFFSET', String(res.result[res.result.length - 1].update_id + 1));
  } finally {
    lock.releaseLock();
  }
}

// "/start <client id>" from the page's link, "/check" or the "I've joined" button after joining the group.
function tgUpdate_(cfg, sh, u) {
  var q = u.callback_query, msg = u.message;
  if (q) tgApi_(cfg, 'answerCallbackQuery', { callback_query_id: q.id });
  var from = q ? q.from : msg && msg.from;
  // As a group admin the bot would also receive the group's messages: skipped, never stored.
  if (!from || from.is_bot || (msg && msg.chat.type !== 'private')) return;
  var text = q ? '/check' : String(msg.text || '').trim();
  var start = /^\/start\s+([A-Za-z0-9_-]{1,64})$/.exec(text);
  var row = start ? findRow_(sh, 'Client ID', start[1]) : /^\/(start|check)\b/.test(text) ? findLastRow_(sh, 'Telegram ID', from.id) : -1;
  if (row < 0) return tgSay_(cfg, from.id, 'Hi! I check that visitors to the Kleros booth at Devcon joined the Kleros Telegram group. Start from the check-in page: ' + cfg.site);

  var m = merch_(sh, row);
  if (gateOn_() && sh.getRange(row, col_('Newsletter')).getValue() === 'Yes') return tgSay_(cfg, from.id, 'Confirm your email on the check-in page first, then tap the Telegram button there again.');
  if (m['Claim'] === 'Already claimed') return tgSay_(cfg, from.id, 'This check-in was already claimed: one merch per person.');
  if (m['Telegram check'] === 'Joined') return tgSay_(cfg, from.id, '✅ You’re already verified. Switch back to your browser to see your merch tier.');
  var who = { 'Telegram ID': from.id, 'Telegram account': text_(from.username ? '@' + from.username : [from.first_name, from.last_name].join(' ').trim()) };

  // One Telegram account unlocks one check-in.
  var last = lastRow_(sh), tg = sh.getRange(3, col_('Telegram check'), last - 2, 3).getValues();   // check, account, ID
  var used = tg.some(function (r, i) { return i !== row - 3 && r[0] === 'Joined' && String(r[2]) === String(from.id); });
  if (used) {
    merch_(sh, row, { 'Claim': 'Already claimed', 'Telegram check': 'Already used', 'Telegram ID': who['Telegram ID'], 'Telegram account': who['Telegram account'] });
    return tgSay_(cfg, from.id, 'This Telegram account already unlocked a check-in at the Kleros booth. One merch per person!');
  }

  var cm = tgApi_(cfg, 'getChatMember', { chat_id: cfg.group, user_id: from.id });
  var joined = cm.ok && (TG_MEMBER.indexOf(cm.result.status) >= 0 || (cm.result.status === 'restricted' && cm.result.is_member));
  who['Telegram check'] = !cm.ok ? 'Check failed' : joined ? 'Joined' : 'Not joined yet';
  merch_(sh, row, who);
  if (!cm.ok) return tgSay_(cfg, from.id, 'I couldn’t check the Kleros group just now. Try again in a minute, or ask the Kleros team at the booth.', [[{ text: 'Try again', callback_data: 'check' }]]);
  if (joined) return tgSay_(cfg, from.id, '✅ You’re in the Kleros group, thanks for joining! Switch back to your browser: your merch tier updates by itself.');
  tgSay_(cfg, from.id, 'Almost there! Join the Kleros group first, then tap “I’ve joined”.',
    [[{ text: 'Join the Kleros group', url: cfg.groupUrl }], [{ text: 'I’ve joined', callback_data: 'check' }]]);
}

/** Run once after adding TELEGRAM_BOT_TOKEN: checks the bot and its group, and answers visitors every minute even when no page is polling. */
function telegramSetup() {
  var cfg = tgConfig_();
  if (!cfg) { Logger.log('NOT SET UP: no valid TELEGRAM_BOT_TOKEN in Script properties.'); return; }
  var me = tgApi_(cfg, 'getMe');
  if (!me.ok) { Logger.log('Telegram refused the token: ' + me.description); return; }
  tgApi_(cfg, 'deleteWebhook');   // getUpdates only works without a webhook
  tgApi_(cfg, 'setMyCommands', { commands: [{ command: 'check', description: 'Check that I joined the Kleros group' }] });
  // Can the bot look up members? Try it on one of the group's human admins.
  var bot = tgApi_(cfg, 'getChatMember', { chat_id: cfg.group, user_id: me.result.id });
  var admins = tgApi_(cfg, 'getChatAdministrators', { chat_id: cfg.group });
  var human = admins.ok && admins.result.filter(function (a) { return !a.user.is_bot; })[0];
  var probe = human && tgApi_(cfg, 'getChatMember', { chat_id: cfg.group, user_id: human.user.id });
  Logger.log('Bot @' + me.result.username + ' in ' + cfg.group + ': ' + (bot.ok ? bot.result.status : bot.description) + '. Member lookups: ' +
    (probe && probe.ok ? 'working.' : 'NOT working. A group admin who can add admins must make the bot an admin (no permissions needed).'));
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'telegramTick'; });
  if (!has) ScriptApp.newTrigger('telegramTick').timeBased().everyMinutes(1).create();
  Logger.log('Answering the bot every minute (trigger telegramTick). Run telegramStop after Devcon.');
}

function telegramTick() {
  var cfg = tgConfig_();
  if (cfg) telegramUpdates_(cfg);
}

/** After Devcon: stop the every-minute bot check. */
function telegramStop() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'telegramTick') ScriptApp.deleteTrigger(t); });
}

/**
 * Run once: makes the webhook secret (kept if it exists) and logs the target URL for the Ghost admin's two
 * webhooks, member.added and member.edited. The URL holds the secret, so send it privately, never in a channel.
 * Turns the blog gate on: from now on visitors pass once Ghost reports them.
 */
function ghostWebhookSetup() {
  var p = PropertiesService.getScriptProperties();
  if (!ghostSecret_()) p.setProperty('GHOST_WEBHOOK_SECRET', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
  Logger.log('Ghost webhook target URL (member.added and member.edited): ' + WEB_APP_URL + '?hook=ghost&secret=' + ghostSecret_());
}

/** The booth doesn't wait for the blog confirmation (Ghost's own double opt-in is unchanged). */
function blogGateOff() {
  PropertiesService.getScriptProperties().setProperty('BLOG_GATE', 'off');
  Logger.log('Blog gate OFF: visitors reach the final screen right after checking in. Ghost still asks them to confirm by email.');
}

/** Back to waiting for the blog confirmation before the final screen. */
function blogGateOn() {
  PropertiesService.getScriptProperties().deleteProperty('BLOG_GATE');
  Logger.log('Blog gate ON: visitors reach the final screen once Ghost reports their confirmation.');
}

/** Run from the editor: the last 10 Ghost webhook calls and how each went (no secrets or emails in it). */
function ghostWebhookStatus() {
  Logger.log('Blog gate: ' + (gateOn_() ? 'ON (waits for confirmation)' : 'OFF (no waiting)') + '. Webhook secret set: ' + !!ghostSecret_());
  JSON.parse(PropertiesService.getScriptProperties().getProperty('GHOST_HOOK_LOG') || '[]').forEach(function (x) { Logger.log(JSON.stringify(x)); });
}

/* ------------------------------------------------------------- examples */

// Fictional people and companies (marked EX- and "(example)") so the team can see a filled-in database.
// They go through the same check-in and enrich paths as real data. Delete them before Devcon.
var EXAMPLES = [
  { c: ['Aria Menon', 'Agentra Labs (example)', 'Founder / C-level', 'Founder / C-suite', ['Disputes for AI Agents'], '', 'Arbitrating failed jobs between agents on our marketplace', 'Agent-to-agent services marketplace', true],
    r: { 'Research status': 'Done', 'Confidence': 'High', 'Verified title': 'Co-founder & CEO', 'Company summary': 'Agent marketplace where AI agents hire other agents for tasks.', 'Company stage': 'Seed', 'Ecosystems': 'Base, Ethereum', 'Relevance to Kleros': 'Needs a dispute route when an agent job fails; natural fit for the Dispute Service.', 'Flag type': 'Integration', 'Flags': 'Asked for a call and building agent payments with x402. Design-partner candidate.', 'Sources': 'example' } },
  { c: ['Lina Shah', 'PayNova (example)', 'Product Manager', 'Manager / Team lead', ['Enterprise & Customer Disputes'], '', 'Chargeback disputes for crypto card users', 'Crypto debit card', false],
    r: { 'Research status': 'Done', 'Confidence': 'High', 'Verified title': 'Senior PM, Disputes', 'Company summary': 'Neobank with a crypto card.', 'Company stage': 'Series A+', 'Ecosystems': 'Polygon', 'Relevance to Kleros': 'Owns the disputes product; matches the Kleros Enterprise chargeback case.', 'Flag type': 'Enterprise deal', 'Flags': 'Owns budget for disputes tooling.', 'Sources': 'example' } },
  { c: ['Omar Rizvi', 'ListGuard Wallet (example)', 'Engineer / Developer', 'Individual contributor', ['DeFi Curation & Token Lists'], 'Wallet security', 'Community-curated scam address list', 'Wallet scam warnings', false], r: null }
];

function loadExamples() {
  var key = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  EXAMPLES.forEach(function (x, i) {
    var t = 'EX-' + ('0' + (i + 1)).slice(-2);
    var c = x.c;
    checkIn_({ id: 'example-' + (i + 1), ticket: t, ts: new Date().toISOString(), name: 'Example: ' + c[0], company: c[1],
      position: c[2], seniority: c[3], interests: c[4], otherInterest: c[5], klerosUse: c[6], building: c[7], wantsCall: c[8],
      email: c[0].split(' ')[1].toLowerCase() + '@example.com', newsletter: true, source: 'example', event: 'Devcon VIII Mumbai' });
    if (x.r) enrich_({ key: key, ticket: t, agent: 'example-agent', fields: x.r, note: 'example row' });
  });
}

function deleteExamples() {
  var sh = sheet_(LEADS);
  var n = sh.getLastRow();
  if (n >= 3) {
    var vals = sh.getRange(3, 1, n - 2, HEADERS.length).getValues();
    var g = function (r, h) { return String(r[col_(h) - 1] || ''); };
    for (var i = vals.length - 1; i >= 0; i--) {
      var r = vals[i];
      var isExample = g(r, 'Ticket').indexOf('EX-') === 0;
      var isTest = g(r, 'Name').indexOf('Test:') === 0;
      // A row with matching output but no ticket is junk from a malformed request.
      var isJunk = !g(r, 'Ticket') && !!(g(r, 'Pipeline') || g(r, 'Client ID') || g(r, 'Name'));
      if (isExample || isTest || isJunk) sh.deleteRow(i + 3);
    }
  }
  var log = sheet_(LOG);
  for (var k = log.getLastRow(); k >= 2; k--) {
    if (String(log.getRange(k, 3).getValue()).indexOf('EX-') === 0) log.deleteRow(k);
  }
}
