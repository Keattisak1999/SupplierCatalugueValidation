// Pure data logic for the supplier catalogue validation tool.
// No DOM and no SheetJS dependency, so it runs in the browser and in Node tests.

export const STATUS = {
  EXISTING: 'Existing Item',
  NEW: 'New Item',
  ONLY_WS: 'Only in WS Item List',
  MISSING_ARTICLE: 'Missing Article No.',
};

// Standard headers, taken from report "Item List 1014".
export const FIELDS = [
  {
    key: 'wsNo',
    label: 'WS No.',
    aliases: ['ws no', 'ws number', 'ws item no', 'ws item number', 'wsno', 'ws id'],
  },
  {
    key: 'itemName',
    label: 'Item name',
    aliases: [
      'item name', 'article name', 'product name', 'item description', 'article description',
      'product description', 'description', 'name', 'item',
    ],
  },
  {
    key: 'articleNo',
    label: 'Article no.',
    required: true,
    aliases: [
      'article no', 'article number', 'art no', 'article nr', 'artikelnummer', 'artikel nr',
      'supplier article no', 'supplier article number', 'item code', 'item no', 'item number',
      'product code', 'product no', 'material no', 'material number', 'sku', 'ref no', 'reference', 'code',
    ],
  },
  {
    key: 'gtin',
    label: 'GTIN',
    aliases: ['gtin', 'ean', 'ean code', 'ean13', 'barcode', 'bar code', 'upc'],
  },
  {
    key: 'orderUnit',
    label: 'Order Unit',
    aliases: ['order unit', 'ordering unit', 'order uom', 'sales unit', 'uom', 'unit of measure', 'unit'],
  },
  {
    key: 'packagingUnit',
    label: 'Packaging unit',
    aliases: ['packaging unit', 'packing unit', 'package unit', 'pack unit', 'pack size', 'packaging', 'packing', 'content'],
  },
];

// Common supplier spellings that do not literally match a unit code or name.
const UNIT_ALIASES = {
  PCS: 'PC', PCE: 'PC', PIECE: 'PC', PIECES: 'PC',
  EA: 'ST', EACH: 'ST',
  KGS: 'KG', KILO: 'KG', KILOS: 'KG',
  G: 'GR', GM: 'GR', GRM: 'GR', GRAMS: 'GR',
  L: 'LI', LT: 'LI', LTR: 'LI', LITER: 'LI', LITRE: 'LI', LITERS: 'LI', LITRES: 'LI',
  MLS: 'ML', MILLILITER: 'ML',
  BTL: 'FL', BOTTLE: 'FL', BOTTLES: 'FL',
  CTN: 'CT', CARTON: 'CT', CARTONS: 'CT',
  PKT: 'SC', PACKET: 'SC',
  PK: 'PG', PACK: 'PG', PKG: 'PG',
  CAN: 'DO', CANS: 'DO',
  BOXES: 'BO', BX: 'BO',
  BAGS: 'BT',
  TRAYS: 'TR',
  ROLLS: 'RO',
  LB: 'PF', LBS: 'PU',
  DOZ: 'DZ',
};

const normHeader = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function cellText(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  if (typeof v === 'number') {
    // Avoid "1.23E+12"-style output for long article numbers / GTINs.
    return Number.isInteger(v) && Math.abs(v) < 1e21
      ? BigInt(v).toString()
      : String(v);
  }
  return String(v).trim();
}

const rowIsEmpty = (row) => !row || row.every((c) => cellText(c) === '');

// Guess the header row: the row among the first 30 whose cells best match known header aliases.
export function detectHeaderRow(aoa) {
  const allAliases = FIELDS.flatMap((f) => f.aliases);
  let best = 0;
  let bestScore = -1;
  const limit = Math.min(aoa.length, 30);
  for (let r = 0; r < limit; r++) {
    const row = aoa[r] || [];
    const texts = row.map(normHeader).filter(Boolean);
    if (!texts.length) continue;
    const hits = texts.filter((t) => allAliases.includes(t)).length;
    const textCells = row.filter((c) => typeof c === 'string' && c.trim() !== '').length;
    const score = hits * 10 + textCells;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

// Turn an array-of-arrays into { headers, rows } using the given header row index.
// Headers are made unique and blank headers get a column letter name.
export function tableFromAoa(aoa, headerRow = 0) {
  const headerCells = aoa[headerRow] || [];
  const width = Math.max(headerCells.length, ...aoa.slice(headerRow + 1).map((r) => (r ? r.length : 0)), 0);
  const seen = new Map();
  const headers = [];
  for (let c = 0; c < width; c++) {
    let h = cellText(headerCells[c]) || `Column ${columnLetter(c)}`;
    if (seen.has(h)) {
      const n = seen.get(h) + 1;
      seen.set(h, n);
      h = `${h} (${n})`;
    } else {
      seen.set(h, 1);
    }
    headers.push(h);
  }
  const rows = [];
  for (let r = headerRow + 1; r < aoa.length; r++) {
    const src = aoa[r];
    if (rowIsEmpty(src)) continue;
    const obj = {};
    headers.forEach((h, c) => {
      obj[h] = src[c] ?? '';
    });
    rows.push(obj);
  }
  return { headers, rows };
}

export function columnLetter(i) {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Map standard fields to the best-matching header. Exact alias matches win over partial ones,
// and each header is used at most once.
export function autoMapHeaders(headers) {
  const map = {};
  const used = new Set();
  const normed = headers.map((h) => [h, normHeader(h)]);
  const pick = (field, test) => {
    if (map[field.key]) return;
    for (const alias of field.aliases) {
      const hit = normed.find(([h, n]) => !used.has(h) && test(n, alias));
      if (hit) {
        map[field.key] = hit[0];
        used.add(hit[0]);
        return;
      }
    }
  };
  for (const f of FIELDS) pick(f, (n, a) => n === a);
  for (const f of FIELDS) pick(f, (n, a) => a.length > 3 && (n.startsWith(a + ' ') || n.endsWith(' ' + a)));
  for (const f of FIELDS) map[f.key] = map[f.key] || '';
  return map;
}

export function normalizeKey(value, opts = {}) {
  let s = cellText(value).toUpperCase();
  if (opts.ignoreSeparators) s = s.replace(/[\s\-_./]+/g, '');
  else s = s.replace(/\s+/g, ' ');
  if (opts.ignoreLeadingZeros) s = s.replace(/^0+(?=.)/, '');
  return s;
}

const getField = (row, map, key) => (map[key] ? row[map[key]] : '');

// Core lookup on "Article no." between report 1014 and the supplier file.
export function compareItems({ report, supplier, reportMap, supplierMap, options = {} }) {
  if (!reportMap.articleNo || !supplierMap.articleNo) {
    throw new Error('Article no. must be mapped for both files.');
  }
  const reportIndex = new Map();
  report.rows.forEach((row) => {
    const k = normalizeKey(getField(row, reportMap, 'articleNo'), options);
    if (!k) return;
    if (!reportIndex.has(k)) reportIndex.set(k, []);
    reportIndex.get(k).push(row);
  });

  const supplierCount = new Map();
  supplier.rows.forEach((row) => {
    const k = normalizeKey(getField(row, supplierMap, 'articleNo'), options);
    if (k) supplierCount.set(k, (supplierCount.get(k) || 0) + 1);
  });

  const items = supplier.rows.map((row) => {
    const key = normalizeKey(getField(row, supplierMap, 'articleNo'), options);
    const remarks = [];
    let status;
    let wsRow = null;
    if (!key) {
      status = STATUS.MISSING_ARTICLE;
      remarks.push('Article no. is empty in supplier file');
    } else if (reportIndex.has(key)) {
      status = STATUS.EXISTING;
      const matches = reportIndex.get(key);
      wsRow = matches[0];
      if (matches.length > 1) remarks.push(`Article no. appears ${matches.length} times in WS Item List`);
    } else {
      status = STATUS.NEW;
    }
    if (key && supplierCount.get(key) > 1) {
      remarks.push(`Duplicate article no. in supplier file (${supplierCount.get(key)}x)`);
    }
    return { status, key, supplierRow: row, wsRow, remarks };
  });

  const onlyWs = [];
  report.rows.forEach((row) => {
    const key = normalizeKey(getField(row, reportMap, 'articleNo'), options);
    if (!key) onlyWs.push({ row, remarks: ['Article no. is empty in WS Item List'] });
    else if (!supplierCount.has(key)) onlyWs.push({ row, remarks: [] });
  });

  return { items, onlyWs };
}

export function summarize(result) {
  const count = (s) => result.items.filter((i) => i.status === s).length;
  return {
    existing: count(STATUS.EXISTING),
    newItems: count(STATUS.NEW),
    missingArticle: count(STATUS.MISSING_ARTICLE),
    onlyWs: result.onlyWs.length,
    supplierRows: result.items.length,
  };
}

// Resolve a free-text unit to a FutureLog unit code ('' when unknown).
export function resolveUnitCode(value, units) {
  const raw = cellText(value).toUpperCase().replace(/\s+/g, ' ');
  if (!raw) return '';
  const byCode = units.find((u) => u.code.toUpperCase() === raw);
  if (byCode) return byCode.code;
  const byName = units.find((u) => u.name.toUpperCase() === raw);
  if (byName) return byName.code;
  const compact = raw.replace(/[^A-Z0-9]/g, '');
  if (UNIT_ALIASES[compact]) return UNIT_ALIASES[compact];
  return '';
}

// Distinct supplier order units used by "Existing Item" rows, with counts and a suggested code.
export function existingItemUnits(result, supplierMap, units) {
  const counts = new Map();
  for (const item of result.items) {
    if (item.status !== STATUS.EXISTING) continue;
    const u = cellText(getField(item.supplierRow, supplierMap, 'orderUnit'));
    if (!u) continue;
    counts.set(u, (counts.get(u) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([unit, count]) => ({ unit, count, suggested: resolveUnitCode(unit, units) }));
}

const unitLabel = (code, units) => {
  const u = units.find((x) => x.code === code);
  return u ? `${u.code} (${u.name})` : code;
};

// Returns the "Unit Change" remark for an existing item, or '' when units agree.
export function unitChangeRemark(item, { reportMap, supplierMap, unitMapping, units }) {
  if (item.status !== STATUS.EXISTING) return '';
  const supRaw = cellText(getField(item.supplierRow, supplierMap, 'orderUnit'));
  const wsRaw = cellText(getField(item.wsRow, reportMap, 'orderUnit'));
  if (!supRaw && !wsRaw) return '';
  if (!supRaw) return `Supplier order unit is empty (WS: ${wsRaw})`;
  const supCode = unitMapping[supRaw] || '';
  if (!supCode) return `Supplier unit "${supRaw}" is not mapped`;
  const wsCode = resolveUnitCode(wsRaw, units) || wsRaw.toUpperCase();
  if (!wsRaw) return `WS order unit is empty (Supplier: ${unitLabel(supCode, units)})`;
  if (supCode === wsCode) return '';
  return `Changed: WS ${unitLabel(wsCode, units)} -> Supplier ${unitLabel(supCode, units)}`;
}

// Build the sheets of the output workbook as arrays of arrays.
// unitMapping === null means the unit step was skipped.
export function buildOutput({ result, report, supplier, reportMap, supplierMap, unitMapping, units, meta = {} }) {
  const std = FIELDS.map((f) => f.key);
  const label = Object.fromEntries(FIELDS.map((f) => [f.key, f.label]));
  const unitChecked = unitMapping !== null && unitMapping !== undefined;

  const mappedSupplierCols = new Set(Object.values(supplierMap).filter(Boolean));
  const extraSupplierCols = supplier.headers.filter((h) => !mappedSupplierCols.has(h));
  const mappedReportCols = new Set(Object.values(reportMap).filter(Boolean));
  const extraReportCols = report.headers.filter((h) => !mappedReportCols.has(h));

  const mainHeader = [
    'Status',
    'Unit Change',
    ...std.map((k) => label[k]),
    'Order Unit (FutureLog code)',
    'WS Item name',
    'WS GTIN',
    'WS Order Unit',
    'WS Packaging unit',
    'Remark',
    ...extraSupplierCols.map((h) => `Supplier: ${h}`),
  ];
  const mainRows = result.items.map((item) => {
    const s = item.supplierRow;
    const w = item.wsRow;
    const sv = (k) => cellText(getField(s, supplierMap, k));
    const wv = (k) => (w ? cellText(getField(w, reportMap, k)) : '');
    const supUnit = sv('orderUnit');
    const flCode = unitChecked ? unitMapping[supUnit] || '' : '';
    return [
      item.status,
      unitChecked ? unitChangeRemark(item, { reportMap, supplierMap, unitMapping, units }) : '',
      ...std.map((k) => (k === 'wsNo' ? wv('wsNo') || sv('wsNo') : sv(k))),
      flCode,
      wv('itemName'),
      wv('gtin'),
      wv('orderUnit'),
      wv('packagingUnit'),
      item.remarks.join('; '),
      ...extraSupplierCols.map((h) => s[h] ?? ''),
    ];
  });

  const onlyHeader = ['Status', ...std.map((k) => label[k]), 'Remark', ...extraReportCols];
  const onlyRows = result.onlyWs.map(({ row, remarks }) => [
    STATUS.ONLY_WS,
    ...std.map((k) => cellText(getField(row, reportMap, k))),
    remarks.join('; '),
    ...extraReportCols.map((h) => row[h] ?? ''),
  ]);

  const sum = summarize(result);
  const unitChanges = unitChecked ? mainRows.filter((r) => r[1]).length : null;
  const summary = [
    ['Supplier Catalogue Validation'],
    [],
    ['Generated', meta.generated || new Date().toISOString().slice(0, 19).replace('T', ' ')],
    ['WS Item List (1014) file', meta.reportFile || ''],
    ['Supplier file', meta.supplierFile || ''],
    ['Lookup key', 'Article no.'],
    [],
    ['Status', 'Count'],
    [STATUS.EXISTING, sum.existing],
    [STATUS.NEW, sum.newItems],
    ...(sum.missingArticle ? [[STATUS.MISSING_ARTICLE, sum.missingArticle]] : []),
    [STATUS.ONLY_WS, sum.onlyWs],
    [],
    ['Unit check', unitChecked ? 'Done' : 'Skipped'],
    ...(unitChecked ? [['Existing items with unit change', unitChanges]] : []),
  ];

  return {
    sheets: [
      { name: 'Supplier Validation', aoa: [mainHeader, ...mainRows] },
      { name: 'Only in WS Item List', aoa: [onlyHeader, ...onlyRows] },
      { name: 'Summary', aoa: summary },
    ],
    summary: { ...sum, unitChanges },
  };
}
