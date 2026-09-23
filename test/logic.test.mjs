import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATUS, autoMapHeaders, buildOutput, cellText, compareItems, detectHeaderRow,
  existingItemUnits, normalizeKey, resolveUnitCode, tableFromAoa,
} from '../public/js/logic.js';
import { UNITS } from '../public/js/units.js';

const reportAoa = [
  ['Item List 1014'],
  ['Supplier: Demo Co.'],
  [],
  ['WS No.', 'Item name', 'Article no.', 'GTIN', 'Order unit', 'Packaging unit', 'Price'],
  [1001, 'Milk 1L', 'A-100', 8850000000011, 'LI', '1 L', 40],
  [1002, 'Rice 5kg', 'A-200', '', 'BT', '5 KG', 200],
  [1003, 'Sugar', 'A-300', '', 'KG', '1 KG', 30],
  [1004, 'Old item', 'A-999', '', 'PC', '', 5],
];
const supplierAoa = [
  ['Item Code', 'Description', 'Barcode', 'UOM', 'Pack Size', 'Unit Price'],
  ['a-100', 'Fresh Milk 1 Litre', '8850000000011', 'Litre', '1L', 41],
  ['A-200', 'Jasmine Rice 5kg', '', 'Bag', '5kg', 210],
  ['A-300', 'White sugar', '', 'PCS', '1kg', 31],
  ['B-001', 'New Butter', '', 'PCS', '250g', 90],
  ['', 'No code row', '', 'PCS', '', 1],
];

function setup() {
  const report = tableFromAoa(reportAoa, detectHeaderRow(reportAoa));
  const supplier = tableFromAoa(supplierAoa, detectHeaderRow(supplierAoa));
  const reportMap = autoMapHeaders(report.headers);
  const supplierMap = autoMapHeaders(supplier.headers);
  return { report, supplier, reportMap, supplierMap };
}

test('detects header row below report title lines', () => {
  assert.equal(detectHeaderRow(reportAoa), 3);
  assert.equal(detectHeaderRow(supplierAoa), 0);
});

test('auto maps report and supplier headers', () => {
  const { reportMap, supplierMap } = setup();
  assert.deepEqual(reportMap, {
    wsNo: 'WS No.', itemName: 'Item name', articleNo: 'Article no.', gtin: 'GTIN',
    orderUnit: 'Order unit', packagingUnit: 'Packaging unit',
  });
  assert.equal(supplierMap.articleNo, 'Item Code');
  assert.equal(supplierMap.itemName, 'Description');
  assert.equal(supplierMap.gtin, 'Barcode');
  assert.equal(supplierMap.orderUnit, 'UOM');
  assert.equal(supplierMap.packagingUnit, 'Pack Size');
});

test('cellText keeps long numbers intact', () => {
  assert.equal(cellText(8850000000011), '8850000000011');
  assert.equal(cellText(1.5), '1.5');
  assert.equal(cellText('  x '), 'x');
});

test('normalizeKey options', () => {
  assert.equal(normalizeKey(' a-100 '), 'A-100');
  assert.equal(normalizeKey('000123', { ignoreLeadingZeros: true }), '123');
  assert.equal(normalizeKey('0', { ignoreLeadingZeros: true }), '0');
  assert.equal(normalizeKey('AB-12.3', { ignoreSeparators: true }), 'AB123');
});

test('assigns Existing / New / Only in WS statuses by article no.', () => {
  const ctx = setup();
  const result = compareItems(ctx);
  assert.deepEqual(result.items.map((i) => i.status), [
    STATUS.EXISTING, STATUS.EXISTING, STATUS.EXISTING, STATUS.NEW, STATUS.MISSING_ARTICLE,
  ]);
  assert.equal(result.onlyWs.length, 1);
  assert.equal(result.onlyWs[0].row['Article no.'], 'A-999');
});

test('flags duplicate article numbers', () => {
  const ctx = setup();
  ctx.supplier = tableFromAoa([...supplierAoa, ['A-200', 'Rice again', '', 'Bag', '', 1]], 0);
  const result = compareItems(ctx);
  const dups = result.items.filter((i) => i.remarks.some((r) => r.startsWith('Duplicate')));
  assert.equal(dups.length, 2);
});

test('resolves unit codes from codes, names and aliases', () => {
  assert.equal(resolveUnitCode('kg', UNITS), 'KG');
  assert.equal(resolveUnitCode('Litre', UNITS), 'LI');
  assert.equal(resolveUnitCode('Bag', UNITS), 'BT');
  assert.equal(resolveUnitCode('pcs', UNITS), 'PC');
  assert.equal(resolveUnitCode('whatever', UNITS), '');
});

test('unit list only includes units of existing items', () => {
  const ctx = setup();
  const result = compareItems(ctx);
  const units = existingItemUnits(result, ctx.supplierMap, UNITS);
  assert.deepEqual(units.map((u) => [u.unit, u.count, u.suggested]), [
    ['Bag', 1, 'BT'], ['Litre', 1, 'LI'], ['PCS', 1, 'PC'],
  ]);
});

test('builds output with Unit Change remarks and separate Only in WS sheet', () => {
  const ctx = setup();
  const result = compareItems(ctx);
  const unitMapping = { Litre: 'LI', Bag: 'BT', PCS: 'PC' };
  const out = buildOutput({ ...ctx, result, unitMapping, units: UNITS });
  const [main, only, summary] = out.sheets;
  assert.equal(main.name, 'Supplier Validation');
  assert.equal(only.name, 'Only in WS Item List');
  assert.equal(summary.name, 'Summary');

  const header = main.aoa[0];
  assert.deepEqual(header.slice(0, 8), [
    'Status', 'Unit Change', 'WS No.', 'Item name', 'Article no.', 'GTIN', 'Order Unit', 'Packaging unit',
  ]);
  const unitCol = header.indexOf('Unit Change');
  const rows = main.aoa.slice(1);
  assert.equal(rows[0][unitCol], ''); // Litre -> LI matches WS LI
  assert.equal(rows[1][unitCol], ''); // Bag -> BT matches WS BT
  assert.match(rows[2][unitCol], /WS KG \(Kilogram\) -> Supplier PC \(Piece\)/);
  assert.equal(rows[3][unitCol], ''); // new item: no unit check
  assert.equal(rows[0][header.indexOf('WS No.')], '1001');
  assert.equal(rows[0][header.indexOf('Article no.')], 'a-100');
  assert.equal(rows[0][header.indexOf('Item name')], 'Fresh Milk 1 Litre');
  assert.equal(rows[0][header.indexOf('Order Unit')], 'Litre');
  assert.equal(rows[0][header.indexOf('Packaging unit')], '1L');
  assert.equal(rows[0][header.indexOf('Order Unit (FutureLog code)')], 'LI');
  assert.equal(rows[0][header.indexOf('WS Order Unit')], 'LI');
  assert.equal(rows[0][header.indexOf('GTIN')], '8850000000011');
  assert.ok(header.includes('Supplier: Unit Price'));

  assert.equal(only.aoa.length, 2);
  assert.equal(only.aoa[1][0], STATUS.ONLY_WS);
  assert.ok(only.aoa[0].includes('Price'));
  assert.equal(out.summary.unitChanges, 1);
});

test('skipping unit step leaves Unit Change empty', () => {
  const ctx = setup();
  const result = compareItems(ctx);
  const out = buildOutput({ ...ctx, result, unitMapping: null, units: UNITS });
  assert.ok(out.sheets[0].aoa.slice(1).every((r) => r[1] === ''));
  assert.equal(out.summary.unitChanges, null);
});

test('unmapped supplier unit is flagged', () => {
  const ctx = setup();
  const result = compareItems(ctx);
  const out = buildOutput({ ...ctx, result, unitMapping: { Litre: 'LI', Bag: '' , PCS: 'KG' }, units: UNITS });
  const rows = out.sheets[0].aoa.slice(1);
  assert.match(rows[1][1], /not mapped/);
  assert.equal(rows[2][1], ''); // PCS mapped to KG matches WS KG
});
