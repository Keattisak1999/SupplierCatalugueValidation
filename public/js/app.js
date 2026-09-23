import {
  FIELDS, STATUS, autoMapHeaders, buildOutput, cellText, compareItems, detectHeaderRow,
  existingItemUnits, summarize, tableFromAoa,
} from './logic.js';
import { UNITS } from './units.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined) node.append(c);
  return node;
};

const state = {
  files: { report: null, supplier: null }, // { name, workbook, sheet, headerRow, aoa, table }
  reportMap: {},
  supplierMap: {},
  options: { ignoreLeadingZeros: false, ignoreSeparators: false },
  result: null,
  unitMapping: {},
  unitSkipped: false,
  output: null,
  filter: 'all',
};

// ---------- Step navigation ----------
function go(step) {
  for (let i = 1; i <= 4; i++) $(`#step-${i}`).hidden = i !== step;
  document.querySelectorAll('#stepper li').forEach((li) => {
    const n = Number(li.dataset.step);
    li.classList.toggle('active', n === step);
    li.classList.toggle('done', n < step);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => go(Number(b.dataset.back))));

// ---------- Step 1: files ----------
async function readWorkbook(file) {
  const isText = /\.(csv|txt)$/i.test(file.name);
  if (isText) {
    const text = new TextDecoder('utf-8').decode(await file.arrayBuffer());
    // raw: keep values as text so leading zeros in article numbers survive.
    return XLSX.read(text, { type: 'string', raw: true });
  }
  return XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
}

function sheetAoa(workbook, sheetName) {
  const ws = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: true });
}

function loadSheet(which, sheetName, headerRow) {
  const f = state.files[which];
  f.sheet = sheetName;
  f.aoa = sheetAoa(f.workbook, sheetName);
  f.headerRow = headerRow ?? detectHeaderRow(f.aoa);
  f.table = tableFromAoa(f.aoa, f.headerRow);
  if (which === 'report') state.reportMap = autoMapHeaders(f.table.headers);
  else state.supplierMap = autoMapHeaders(f.table.headers);
  renderFileInfo(which);
  updateStep1();
}

function renderFileInfo(which) {
  const f = state.files[which];
  const box = $(`#info-${which}`);
  box.replaceChildren();
  if (!f) return;
  const sheetSel = el('select', {
    onchange: (e) => loadSheet(which, e.target.value),
  }, f.workbook.SheetNames.map((n) => el('option', { value: n, selected: n === f.sheet }, n)));
  const rowInput = el('input', {
    type: 'number', min: 1, max: Math.max(1, f.aoa.length), value: f.headerRow + 1,
    onchange: (e) => {
      const v = Math.min(Math.max(1, Number(e.target.value) || 1), Math.max(1, f.aoa.length));
      loadSheet(which, f.sheet, v - 1);
    },
  });
  const headers = f.table.headers.slice(0, 12);
  box.append(
    el('div', { class: 'file-name' }, el('strong', {}, f.name), el('span', { class: 'pill' }, `${f.table.rows.length} rows`)),
    el('div', { class: 'file-controls' },
      el('label', {}, 'Sheet ', sheetSel),
      el('label', {}, 'Header row ', rowInput)),
    el('div', { class: 'chips' },
      headers.map((h) => el('span', { class: 'chip' }, h)),
      f.table.headers.length > 12 ? el('span', { class: 'chip muted' }, `+${f.table.headers.length - 12} more`) : null),
  );
}

async function handleFile(which, file) {
  if (!file) return;
  const box = $(`#info-${which}`);
  box.replaceChildren(el('p', { class: 'hint' }, `Reading ${file.name}…`));
  try {
    const workbook = await readWorkbook(file);
    state.files[which] = { name: file.name, workbook };
    // Prefer the first sheet that has data.
    const first = workbook.SheetNames.find((n) => sheetAoa(workbook, n).some((r) => r.some((c) => cellText(c)))) || workbook.SheetNames[0];
    loadSheet(which, first);
  } catch (err) {
    state.files[which] = null;
    box.replaceChildren(el('p', { class: 'error' }, `Could not read ${file.name}: ${err.message}`));
    updateStep1();
  }
}

function setupDrop(which) {
  const zone = $(`#drop-${which}`);
  const input = zone.querySelector('input');
  input.addEventListener('change', () => handleFile(which, input.files[0]));
  zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('over'); }));
  zone.addEventListener('drop', (e) => handleFile(which, e.dataTransfer.files[0]));
}
setupDrop('report');
setupDrop('supplier');

function updateStep1() {
  const { report, supplier } = state.files;
  const ok = report?.table?.rows.length && supplier?.table?.rows.length;
  $('#next-1').disabled = !ok;
  $('#msg-1').textContent = ok ? '' : 'Add both files to continue.';
}
$('#next-1').addEventListener('click', () => { renderHeaderMap(); go(2); });

// ---------- Step 2: header mapping ----------
function columnSelect(headers, value, onChange) {
  return el('select', { onchange: (e) => onChange(e.target.value) },
    el('option', { value: '' }, '— not mapped —'),
    headers.map((h) => el('option', { value: h, selected: h === value }, h)));
}

function sampleValues(table, col) {
  if (!col) return '';
  const vals = [];
  for (const r of table.rows) {
    const v = cellText(r[col]);
    if (v && !vals.includes(v)) vals.push(v);
    if (vals.length === 3) break;
  }
  return vals.join(' · ');
}

function renderHeaderMap() {
  const rep = state.files.report.table;
  const sup = state.files.supplier.table;
  const body = $('#header-map');
  body.replaceChildren(...FIELDS.map((f) => {
    const repSample = el('div', { class: 'sample' }, sampleValues(rep, state.reportMap[f.key]));
    const supSample = el('div', { class: 'sample' }, sampleValues(sup, state.supplierMap[f.key]));
    return el('tr', { class: f.required ? 'required' : '' },
      el('th', {}, f.label, f.required ? el('span', { class: 'req' }, ' *') : null),
      el('td', {}, columnSelect(rep.headers, state.reportMap[f.key], (v) => {
        state.reportMap[f.key] = v; repSample.textContent = sampleValues(rep, v); updatePreview();
      }), repSample),
      el('td', {}, columnSelect(sup.headers, state.supplierMap[f.key], (v) => {
        state.supplierMap[f.key] = v; supSample.textContent = sampleValues(sup, v); updatePreview();
      }), supSample));
  }));
  $('#opt-zeros').checked = state.options.ignoreLeadingZeros;
  $('#opt-seps').checked = state.options.ignoreSeparators;
  updatePreview();
}
$('#opt-zeros').addEventListener('change', (e) => { state.options.ignoreLeadingZeros = e.target.checked; updatePreview(); });
$('#opt-seps').addEventListener('change', (e) => { state.options.ignoreSeparators = e.target.checked; updatePreview(); });

function runCompare() {
  return compareItems({
    report: state.files.report.table,
    supplier: state.files.supplier.table,
    reportMap: state.reportMap,
    supplierMap: state.supplierMap,
    options: state.options,
  });
}

function countCards(sum) {
  return [
    el('div', { class: 'count existing' }, el('b', {}, sum.existing), STATUS.EXISTING),
    el('div', { class: 'count new' }, el('b', {}, sum.newItems), STATUS.NEW),
    el('div', { class: 'count only' }, el('b', {}, sum.onlyWs), STATUS.ONLY_WS),
    sum.missingArticle ? el('div', { class: 'count missing' }, el('b', {}, sum.missingArticle), STATUS.MISSING_ARTICLE) : null,
  ].filter(Boolean);
}

function updatePreview() {
  const box = $('#preview-counts');
  const ok = state.reportMap.articleNo && state.supplierMap.articleNo;
  $('#next-2').disabled = !ok;
  $('#msg-2').textContent = ok ? '' : 'Map Article no. for both files.';
  if (!ok) { box.replaceChildren(); return; }
  state.result = runCompare();
  box.replaceChildren(el('span', { class: 'hint' }, 'Live preview:'), ...countCards(summarize(state.result)));
}

$('#next-2').addEventListener('click', () => {
  state.result = runCompare();
  renderUnitMap();
  go(3);
});

// ---------- Step 3: unit mapping ----------
function unitSelect(value, onChange) {
  return el('select', { class: value ? '' : 'unset', onchange: (e) => { e.target.className = e.target.value ? '' : 'unset'; onChange(e.target.value); } },
    el('option', { value: '' }, '— select unit —'),
    UNITS.map((u) => el('option', { value: u.code, selected: u.code === value }, `${u.code} – ${u.name}`)));
}

function renderUnitMap() {
  const body = $('#unit-body');
  const canCheck = state.reportMap.orderUnit && state.supplierMap.orderUnit;
  $('#next-3').disabled = !canCheck;
  if (!canCheck) {
    body.replaceChildren(el('p', { class: 'notice' }, 'Order Unit is not mapped for both files, so the unit check cannot run. Go back to map it, or skip this step.'));
    return;
  }
  const units = existingItemUnits(state.result, state.supplierMap, UNITS);
  if (!units.length) {
    body.replaceChildren(el('p', { class: 'notice' }, 'No Existing Items with an order unit were found. You can skip this step.'));
    return;
  }
  for (const u of units) {
    if (!(u.unit in state.unitMapping)) state.unitMapping[u.unit] = u.suggested;
  }
  const status = el('p', { class: 'hint' });
  const refresh = () => {
    const missing = units.filter((u) => !state.unitMapping[u.unit]).length;
    status.textContent = missing
      ? `${missing} of ${units.length} units not mapped yet. Unmapped units are flagged in the Unit Change column.`
      : `All ${units.length} units mapped.`;
  };
  body.replaceChildren(
    el('div', { class: 'table-scroll' },
      el('table', { class: 'map-table' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Supplier unit'), el('th', {}, 'Existing items'), el('th', {}, 'FutureLog unit'))),
        el('tbody', {}, units.map((u) => el('tr', {},
          el('th', {}, u.unit),
          el('td', { class: 'num' }, u.count),
          el('td', {}, unitSelect(state.unitMapping[u.unit], (v) => { state.unitMapping[u.unit] = v; refresh(); }))))))),
    status,
  );
  refresh();
}

$('#skip-3').addEventListener('click', () => { state.unitSkipped = true; renderResult(); go(4); });
$('#next-3').addEventListener('click', () => { state.unitSkipped = false; renderResult(); go(4); });

// ---------- Step 4: result ----------
function renderResult() {
  state.output = buildOutput({
    result: state.result,
    report: state.files.report.table,
    supplier: state.files.supplier.table,
    reportMap: state.reportMap,
    supplierMap: state.supplierMap,
    unitMapping: state.unitSkipped ? null : state.unitMapping,
    units: UNITS,
    meta: { reportFile: state.files.report.name, supplierFile: state.files.supplier.name },
  });
  const sum = state.output.summary;
  $('#result-cards').replaceChildren(
    ...countCards(sum),
    el('div', { class: 'count unit' }, el('b', {}, sum.unitChanges ?? '–'), state.unitSkipped ? 'Unit check skipped' : 'Unit changes'),
  );
  state.filter = 'all';
  renderFilters();
  renderTable();
}

const FILTERS = [
  ['all', 'All supplier items'],
  [STATUS.EXISTING, STATUS.EXISTING],
  [STATUS.NEW, STATUS.NEW],
  ['unit', 'Unit Change'],
  ['onlyws', STATUS.ONLY_WS],
];

function renderFilters() {
  $('#result-filters').replaceChildren(...FILTERS.map(([key, label]) => el('button', {
    class: `chip-btn${state.filter === key ? ' on' : ''}`,
    onclick: () => { state.filter = key; renderFilters(); renderTable(); },
  }, label)));
}

const PREVIEW_LIMIT = 200;
function renderTable() {
  const [main, onlyWs] = state.output.sheets;
  const useOnly = state.filter === 'onlyws';
  const [header, ...rows] = useOnly ? onlyWs.aoa : main.aoa;
  let shown = rows;
  if (state.filter === 'unit') shown = rows.filter((r) => r[1]);
  else if (!useOnly && state.filter !== 'all') shown = rows.filter((r) => r[0] === state.filter);
  const cols = useOnly ? header.length : Math.min(header.length, 14); // hide passthrough columns in preview
  const statusClass = (s) => ({
    [STATUS.EXISTING]: 'existing', [STATUS.NEW]: 'new', [STATUS.ONLY_WS]: 'only', [STATUS.MISSING_ARTICLE]: 'missing',
  }[s] || '');
  $('#result-table').replaceChildren(
    el('thead', {}, el('tr', {}, header.slice(0, cols).map((h) => el('th', {}, h)))),
    el('tbody', {}, shown.slice(0, PREVIEW_LIMIT).map((r) => el('tr', {},
      r.slice(0, cols).map((v, i) => (i === 0
        ? el('td', {}, el('span', { class: `status ${statusClass(v)}` }, v))
        : el('td', { class: !useOnly && i === 1 && v ? 'warn' : '' }, cellText(v))))))),
  );
  $('#result-note').textContent = shown.length > PREVIEW_LIMIT
    ? `Showing ${PREVIEW_LIMIT} of ${shown.length} rows. The Excel file contains all rows.`
    : `${shown.length} rows.`;
}

$('#download').addEventListener('click', () => {
  const wb = XLSX.utils.book_new();
  for (const s of state.output.sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.aoa, { cellDates: true });
    const header = s.aoa[0] || [];
    ws['!cols'] = header.map((h, c) => {
      let w = cellText(h).length;
      for (let r = 1; r < Math.min(s.aoa.length, 300); r++) w = Math.max(w, cellText(s.aoa[r][c]).length);
      return { wch: Math.min(Math.max(w + 2, 8), 60) };
    });
    if (s.name !== 'Summary' && s.aoa.length > 1) {
      ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: s.aoa.length - 1, c: header.length - 1 } }) };
    }
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  const base = state.files.supplier.name.replace(/\.[^.]+$/, '');
  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `Validation_${base}_${date}.xlsx`);
});

$('#restart').addEventListener('click', () => {
  state.files = { report: null, supplier: null };
  state.reportMap = {}; state.supplierMap = {};
  state.result = null; state.unitMapping = {}; state.output = null;
  ['report', 'supplier'].forEach((w) => { $(`#info-${w}`).replaceChildren(); $(`#drop-${w} input`).value = ''; });
  updateStep1();
  go(1);
});

if (typeof XLSX === 'undefined') {
  $('#msg-1').textContent = 'Spreadsheet library failed to load (vendor/xlsx.full.min.js). Run "npm run build".';
} else {
  updateStep1();
}
go(1);
