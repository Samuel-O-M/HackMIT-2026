/**
 * Experiment: read a Clinical Study Protocol (.pdf / .docx) with an LLM and
 * print what it found, with per-field confidence.
 *
 *   npm install
 *   node extract.ts [file] [--model gpt-5.6-luna] [--effort low] [--json] [--skip-grounding]
 *
 * `file` defaults to the R2810-ONC-1540 protocol sitting next to this script.
 * Reads OPENAI_API_KEY from the repo-root .env.
 *
 * Confidence is the model's own estimate, so it is not calibrated. To help judge
 * it, every scalar value is also checked against the document text ("in text"):
 * a confident value that does not appear verbatim deserves a second look.
 *
 * Rules are then grounded through ../medical_data: the class each rule names is
 * looked up in RxClass and the ids are written onto the rule (`classIds`), so
 * a drug can later be checked against the rule by membership.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';
import drugdb from '../medical_data/index.js';
import type { ExtractedField, Phase, ProhibitedRule, ProtocolExtraction } from './types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = path.join(here, 'R2810-ONC-1540_Protocol_Amendment9.pdf');

try {
  process.loadEnvFile(path.join(here, '..', '.env'));
} catch {
  // Fall through to whatever is already in the environment.
}

/* -------------------------------------------------------------------------- */
/*  Document -> text                                                          */
/* -------------------------------------------------------------------------- */

interface DocumentText {
  /** Text handed to the model. PDFs carry [[Page N]] markers so it can cite pages. */
  forModel: string;
  /** Text without markers, for the "in text" check. */
  plain: string;
  pages: number | null;
}

async function readDocument(file: string): Promise<DocumentText> {
  const ext = path.extname(file).toLowerCase();
  const buf = await readFile(file);

  if (ext === '.pdf') {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: false });
    return {
      forModel: text.map((t, i) => `[[Page ${i + 1}]]\n${t}`).join('\n\n'),
      plain: text.join('\n'),
      pages: text.length,
    };
  }
  if (ext === '.docx') {
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return { forModel: value, plain: value, pages: null };
  }
  throw new Error(`Unsupported file type "${ext}". Use .pdf or .docx.`);
}

/* -------------------------------------------------------------------------- */
/*  The model call                                                            */
/* -------------------------------------------------------------------------- */

/** A rule as the model returns it, before ids are assigned. */
type RuleCandidate = Omit<ProhibitedRule, 'ruleId'> & { confidence: number };

interface RawExtraction {
  studyId: ExtractedField<string>;
  nctId: ExtractedField<string>;
  shortTitle: ExtractedField<string>;
  investigationalProduct: ExtractedField<string>;
  indication: ExtractedField<string>;
  phase: ExtractedField<Phase>;
  principalInvestigator: ExtractedField<string>;
  conmedSection: ExtractedField<string>;
  rules: RuleCandidate[];
  notes: string | null;
}

const nullableString = { type: ['string', 'null'] };

const fieldSchema = (valueSchema: object = nullableString) => ({
  type: 'object',
  additionalProperties: false,
  required: ['value', 'confidence', 'sourceHint'],
  properties: {
    value: valueSchema,
    confidence: { type: 'number' },
    sourceHint: nullableString,
  },
});

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'studyId',
    'nctId',
    'shortTitle',
    'investigationalProduct',
    'indication',
    'phase',
    'principalInvestigator',
    'conmedSection',
    'rules',
    'notes',
  ],
  properties: {
    studyId: fieldSchema(),
    nctId: fieldSchema(),
    shortTitle: fieldSchema(),
    investigationalProduct: fieldSchema(),
    indication: fieldSchema(),
    phase: fieldSchema({ type: ['string', 'null'], enum: ['Phase 1', 'Phase 2', 'Phase 3', null] }),
    principalInvestigator: fieldSchema(),
    conmedSection: fieldSchema(),
    rules: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['matchedOn', 'label', 'className', 'protocolSection', 'rationale', 'threshold', 'confidence'],
        properties: {
          matchedOn: { type: 'string', enum: ['drug', 'class'] },
          label: { type: 'string' },
          className: nullableString,
          protocolSection: { type: 'string' },
          rationale: { type: 'string' },
          threshold: nullableString,
          confidence: { type: 'number' },
        },
      },
    },
    notes: nullableString,
  },
};

const SYSTEM_PROMPT = `You read Clinical Study Protocols for a clinical trial site and pull out the details a coordinator needs to open the trial.

Fields (every one has value, confidence, sourceHint):
- studyId: the sponsor's protocol number, e.g. "R2810-ONC-1540".
- nctId: the ClinicalTrials.gov identifier, "NCT" + 8 digits.
- shortTitle: a short name a coordinator would say aloud, e.g. "Cemiplimab in advanced CSCC". Derive it from the full title; keep it under ~8 words.
- investigationalProduct: the study drug, with its code name in parentheses if the document gives one.
- indication: the condition being treated.
- phase: exactly "Phase 1", "Phase 2" or "Phase 3". For a combined phase (e.g. 2/3) pick the higher-numbered phase and say so in notes.
- principalInvestigator: a named principal investigator for the site. Protocols usually name a sponsor medical monitor or signatory instead; those are NOT the principal investigator. If no site PI is named, return null.
- conmedSection: the section NUMBER (e.g. "5.7.2") of the section that lists prohibited medications / treatments, not its title.

rules: one entry per prohibited medication or medication class in that section.
- matchedOn is "drug" when a specific drug is named, "class" when a category is banned.
- label is how it reads to a human, e.g. "Systemic corticosteroids > 10 mg/day".
- className is the drug class, or null.
- protocolSection is the section number the rule comes from.
- rationale is the protocol's stated reason, paraphrased in one or two sentences; if the protocol gives none, say so plainly rather than inventing one.
- threshold is a dose or timing qualifier ("> 10 mg/day prednisone equivalent", "within 28 days of first dose"), or null if the ban is absolute.
- Include only what is prohibited. Permitted medications, rescue medications and required treatments are not rules. Do not invent rules the text does not support.

sourceHint: where you found it, as specifically as the text allows, using the [[Page N]] markers when present, e.g. "Title page (p. 1)" or "§5.7.2, p. 87".

confidence: 0 to 1, how sure you are that the value is correct AND read from the document.
- 0.9+ : stated explicitly and unambiguously.
- 0.6-0.9 : stated, but you had to interpret, or several places disagree.
- below 0.6 : inferred, ambiguous, or partly missing.
- If you cannot find a field, return value null, confidence 0, sourceHint null. Never guess to fill a gap.

notes: anything a coordinator should know before trusting this (ambiguities, conflicting values, sections that looked like they should exist but did not), or null.`;

interface ChatResult {
  raw: RawExtraction;
  model: string;
  usage: { prompt_tokens?: number; completion_tokens?: number };
}

async function callModel(text: string, model: string, effort: string): Promise<ChatResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set (expected in the repo-root .env).');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      reasoning_effort: effort,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Clinical Study Protocol follows.\n\n${text}` },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'protocol_extraction', strict: true, schema: SCHEMA },
      },
    }),
  });

  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message ?? `OpenAI error ${res.status}`);

  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error(`Model returned no content (finish_reason: ${data?.choices?.[0]?.finish_reason}).`);
  return { raw: JSON.parse(content), model: data.model ?? model, usage: data.usage ?? {} };
}

/* -------------------------------------------------------------------------- */
/*  Model output -> ProtocolExtraction                                        */
/* -------------------------------------------------------------------------- */

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** Enforce the contract: a missing value is confidence 0, never a guess. */
function cleanField<T>(f: ExtractedField<T>): ExtractedField<T> {
  if (f.value === null || f.value === '') return { value: null, confidence: 0, sourceHint: null };
  return { value: f.value, confidence: clamp01(f.confidence), sourceHint: f.sourceHint };
}

function toExtraction(raw: RawExtraction): ProtocolExtraction {
  return {
    studyId: cleanField(raw.studyId),
    nctId: cleanField(raw.nctId),
    shortTitle: cleanField(raw.shortTitle),
    investigationalProduct: cleanField(raw.investigationalProduct),
    indication: cleanField(raw.indication),
    phase: cleanField(raw.phase),
    principalInvestigator: cleanField(raw.principalInvestigator),
    conmedSection: cleanField(raw.conmedSection),
    // The protocol has no rule ids; the app's PR-#### ids come from its own
    // catalogue. Temporary ones here, so the shape matches the contract.
    rules: raw.rules.map(({ confidence: _c, ...rule }, i) => ({
      ruleId: `TMP-${String(i + 1).padStart(2, '0')}`,
      ...rule,
    })),
    source: 'agent',
    notes: raw.notes,
  };
}

/* -------------------------------------------------------------------------- */
/*  Grounding: rule text -> RxNorm / RxClass ids                              */
/* -------------------------------------------------------------------------- */

interface RuleGrounding {
  /**
   * exact/partial: ids written onto the rule (partial = some words unmatched).
   * weak: candidates only, not applied. none: nothing found.
   */
  status: 'exact' | 'partial' | 'weak' | 'none' | 'unavailable' | 'skipped';
  matches: { id: string; name: string | null; type?: string }[];
  /** Words of the class name that no matched class contains — what "partial" is missing. */
  note?: string;
}

/**
 * The model says what a rule bans, in prose. medical_data turns that into the ids a
 * drug is later checked against, so the check is set membership, not another
 * model's opinion. The model never picks an id; it only supplies the words.
 */
async function groundRules(rules: ProhibitedRule[]): Promise<RuleGrounding[]> {
  const out: RuleGrounding[] = [];
  for (const rule of rules) {
    const name = rule.className ?? rule.label;
    if (rule.matchedOn === 'drug') {
      const found = await drugdb.resolveDrug(name);
      if (found.found) {
        rule.rxcuis = [found.rxcui];
        out.push({ status: found.match === 'exact' ? 'exact' : 'partial', matches: [{ id: found.rxcui, name: found.name }] });
      } else {
        out.push({ status: found.unavailable ? 'unavailable' : 'none', matches: [], note: found.error });
      }
      continue;
    }
    const found = await drugdb.resolveClass(name);
    if (found.unavailable) {
      out.push({ status: 'unavailable', matches: [], note: found.error });
      continue;
    }
    const matches = found.classes.map((c: { classId: string; name: string; type: string }) => ({ id: c.classId, name: c.name, type: c.type }));
    if (found.quality === 'exact' || found.quality === 'partial') {
      rule.classIds = matches.map((m: { id: string }) => m.id);
    }
    out.push({
      status: found.quality,
      matches,
      note:
        found.quality === 'partial'
          ? `applied, but not every word of "${name}" is in these class names`
          : found.quality === 'weak'
            ? `NOT applied: "${name}" only appears inside longer, unrelated class names. Probably not a drug class.`
            : undefined,
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/*  Output                                                                    */
/* -------------------------------------------------------------------------- */

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = paint('2');
const bold = paint('1');
const green = paint('32');
const yellow = paint('33');
const red = paint('31');

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function confidenceBar(c: number): string {
  const filled = Math.round(c * 10);
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
  const pct = `${Math.round(c * 100)}%`.padStart(4);
  const color = c >= 0.85 ? green : c >= 0.6 ? yellow : red;
  return color(`${bar} ${pct}`);
}

function printGrounding(g: RuleGrounding): void {
  const tag = {
    exact: green('matched'),
    partial: yellow('partial'),
    weak: yellow('weak'),
    none: red('no match'),
    unavailable: yellow('rxnorm unavailable'),
    skipped: dim('not checked'),
  }[g.status];
  const shown = g.matches.slice(0, 4).map((m) => `${m.id} ${dim(m.name ?? '')}`);
  const more = g.matches.length > 4 ? dim(` +${g.matches.length - 4} more`) : '';
  console.log(`  ${tag}  ${shown.join(dim(' · '))}${more}`);
  if (g.note) console.log(`  ${' '.repeat(9)}${dim(g.note)}`);
}

function printReport(
  x: ProtocolExtraction,
  raw: RawExtraction,
  grounding: RuleGrounding[],
  plain: string,
  meta: string,
): void {
  const haystack = squash(plain);
  const scalars: [string, ExtractedField<string>][] = [
    ['studyId', x.studyId],
    ['nctId', x.nctId],
    ['shortTitle', x.shortTitle],
    ['investigationalProduct', x.investigationalProduct],
    ['indication', x.indication],
    ['phase', x.phase],
    ['principalInvestigator', x.principalInvestigator],
    ['conmedSection', x.conmedSection],
  ];

  console.log(bold('\nProtocol details'));
  for (const [name, f] of scalars) {
    const label = name.padEnd(23);
    if (f.value === null) {
      console.log(`${label}${dim('not found')}`);
      continue;
    }
    const grounded = haystack.includes(squash(f.value));
    console.log(`${label}${f.value}`);
    console.log(
      `${' '.repeat(23)}${confidenceBar(f.confidence)}  ${grounded ? green('in text') : yellow('not verbatim')}  ${dim(f.sourceHint ?? '')}`,
    );
  }

  console.log(bold(`\nProhibited rules (${x.rules.length})`));
  x.rules.forEach((rule, i) => {
    const c = clamp01(raw.rules[i]!.confidence);
    console.log(`\n${rule.ruleId}  ${bold(rule.label)}`);
    console.log(`  ${confidenceBar(c)}  ${dim(`${rule.matchedOn} · ${rule.className ?? 'no class'} · §${rule.protocolSection}`)}`);
    if (rule.threshold) console.log(`  threshold  ${rule.threshold}`);
    console.log(`  ${dim(rule.rationale)}`);
    printGrounding(grounding[i]!);
  });

  if (x.notes) console.log(`\n${bold('Notes')}\n${x.notes}`);
  console.log(`\n${dim(meta)}\n`);
}

/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      model: { type: 'string', default: 'gpt-5.6-luna' },
      effort: { type: 'string', default: 'low' },
      json: { type: 'boolean', default: false },
      'skip-grounding': { type: 'boolean', default: false },
    },
  });
  const file = path.resolve(positionals[0] ?? DEFAULT_FILE);

  const started = Date.now();
  console.error(dim(`Reading ${path.basename(file)}…`));
  const doc = await readDocument(file);
  console.error(dim(`${doc.pages ?? '?'} pages, ${doc.plain.length.toLocaleString()} characters. Asking ${values.model}…`));

  const { raw, model, usage } = await callModel(doc.forModel, values.model, values.effort);
  const extraction = toExtraction(raw);
  const grounding: RuleGrounding[] = values['skip-grounding']
    ? extraction.rules.map(() => ({ status: 'skipped' as const, matches: [] }))
    : await groundRules(extraction.rules);

  if (values.json) {
    console.log(JSON.stringify(extraction, null, 2));
    return;
  }
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  printReport(
    extraction,
    raw,
    grounding,
    doc.plain,
    `${model} · effort ${values.effort} · ${usage.prompt_tokens ?? '?'} in / ${usage.completion_tokens ?? '?'} out tokens · ${secs}s`,
  );
}

main().catch((err) => {
  console.error(red(`\n${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
});
