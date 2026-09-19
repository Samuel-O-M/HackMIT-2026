#!/usr/bin/env node
'use strict';

/**
 * Warm drugs.db so the demo runs with no network: the class catalogue, plus
 * every drug the fixtures and voice seed mention, plus a list of common
 * concomitant medications and brand names.
 *
 *   node build.js
 *
 * Finishes by auditing the RxCUIs written into data/participants/sessions.json
 * against what RxNorm says those names are.
 */

const fs = require('node:fs');
const path = require('node:path');
const db = require('./index');

const COMMON = [
  // analgesics / NSAIDs
  'ibuprofen', 'naproxen', 'aspirin', 'acetaminophen', 'celecoxib', 'diclofenac', 'meloxicam',
  'advil', 'motrin', 'aleve', 'tylenol', 'bayer aspirin', 'excedrin',
  // corticosteroids
  'prednisone', 'prednisolone', 'methylprednisolone', 'dexamethasone', 'hydrocortisone', 'budesonide', 'deltasone',
  // immunosuppressants / antineoplastics
  'methotrexate', 'azathioprine', 'cyclosporine', 'tacrolimus', 'mycophenolate', 'infliximab', 'adalimumab', 'cyclophosphamide', 'capecitabine',
  // cardiometabolic
  'metformin', 'lisinopril', 'losartan', 'amlodipine', 'metoprolol', 'atorvastatin', 'simvastatin', 'rosuvastatin', 'warfarin', 'apixaban', 'clopidogrel',
  'lipitor', 'zocor', 'coumadin', 'eliquis', 'plavix', 'glucophage', 'zestril', 'norvasc',
  // GI / other common
  'omeprazole', 'esomeprazole', 'pantoprazole', 'famotidine', 'ondansetron', 'loperamide', 'prilosec', 'nexium', 'zofran',
  'levothyroxine', 'synthroid', 'allopurinol', 'colchicine', 'acyclovir', 'valacyclovir', 'gabapentin', 'sertraline', 'fluoxetine', 'trazodone',
  'melatonin', 'cholecalciferol', 'vitamin d', 'ascorbic acid', 'multivitamin', 'ginkgo biloba', 'st johns wort',
  // vaccines
  'zoster vaccine live', 'varicella vaccine live', 'measles mumps rubella vaccine', 'influenza vaccine live', 'yellow fever vaccine', 'rotavirus vaccine live',
];

function read(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8'));
  } catch {
    return null;
  }
}

function fixturePairs() {
  const sessions = read('../patient_data/participants/sessions.json');
  const pairs = new Map();
  (function walk(x) {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === 'object') {
      if (x.canonicalName && x.rxcui) pairs.set(`${x.rxcui}|${x.canonicalName}`, { rxcui: x.rxcui, name: x.canonicalName });
      Object.values(x).forEach(walk);
    }
  })(sessions);
  return [...pairs.values()];
}

async function main() {
  const t0 = Date.now();
  const pairs = fixturePairs();
  const names = [...new Set([...COMMON, ...pairs.map((p) => p.name)])];

  process.stdout.write(`Warming class catalogue + ${names.length} drugs`);
  await db.resolveClass('warm'); // loads the ATC + EPC catalogue
  let unresolved = [];
  for (const name of names) {
    const r = await db.resolveDrug(name);
    if (r.found) await db.classify(r.rxcui);
    else unresolved.push(name);
    process.stdout.write('.');
  }
  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${db.DB_PATH}`);
  if (unresolved.length) console.log(`Not resolvable in RxNorm (${unresolved.length}): ${unresolved.join(', ')}`);

  console.log('\nFixture audit (data/participants/sessions.json):');
  let bad = 0;
  for (const p of pairs) {
    const byName = await db.resolveDrug(p.name);
    const byCode = await db.classify(p.rxcui); // also proves the code exists
    const exists = byCode.classes.length > 0 || (await db.resolveDrug(p.rxcui)).found;
    const ok = byName.found && byName.rxcui === p.rxcui;
    if (!ok) bad++;
    console.log(
      `  ${ok ? 'ok ' : 'BAD'} ${p.rxcui.padEnd(8)} ${p.name}` +
        (ok ? '' : `  -> name resolves to ${byName.found ? `${byName.rxcui} (${byName.name})` : 'nothing'}${exists ? '' : '; code not found in RxNorm'}`),
    );
  }
  if (bad) console.log(`\n${bad} fixture code(s) disagree with RxNorm.`);
  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
