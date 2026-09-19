#!/usr/bin/env node
'use strict';

/**
 *   node cli.js drug "tylenol"          resolve a drug name
 *   node cli.js classify 8640           classes for an RxCUI
 *   node cli.js class "systemic corticosteroid"   find classes by name
 *   node cli.js check 8640 H02 N0000175576        is this drug in these classes?
 */

const db = require('./index');

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  let out;
  if (cmd === 'drug') out = await db.resolveDrug(args.join(' '));
  else if (cmd === 'classify') out = await db.classify(args[0]);
  else if (cmd === 'class') out = await db.resolveClass(args.join(' '));
  else if (cmd === 'check') out = await db.inClass(args[0], args.slice(1));
  else {
    console.error('usage: node cli.js drug <name> | classify <rxcui> | class <name> | check <rxcui> <classId...>');
    process.exit(2);
  }
  console.log(JSON.stringify(out, null, 2));
  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
