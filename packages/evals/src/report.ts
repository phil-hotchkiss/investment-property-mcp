import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Case, categories } from './cases.js';
import { dimensions, type Grade } from './grade.js';
import type { HarnessName, Transcript } from './transcript.js';

export type GradedRun = {
  caseId: string;
  category: Case['category'];
  evidence?: string;
  harness: HarnessName;
  model: string;
  run: number;
  grade: Grade;
  finalText: string;
};

type Usage = Transcript['usage'];

/** summary.json. The runner fills everything; the report reads only this file. */
export type Summary = {
  model: string;
  judgeModel: string;
  harnesses: HarnessName[];
  runs: number;
  pricingDate: string;
  usage: Usage;
  judge: Usage & { calls: number };
  startedAt: string;
  stopped: string | null;
  graded: GradedRun[];
};

const uniq = <T>(xs: T[]) => [...new Set(xs)];
const pct = (n: number, d: number) => `${n}/${d} (${d ? Math.round((100 * n) / d) : 0}%)`;
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/**
 * Markdown report over one or more summaries. One summary gives one column per harness; several
 * agent models (from `report --merge`) give one column per harness and model.
 * ponytail: merge is concatenation, so merging two runs of the same model mixes their pass rates.
 */
export function renderReport(summaries: Summary[]): string {
  const runs = summaries.flatMap((s) => s.graded);
  const models = uniq(summaries.map((s) => s.model));
  const colOf = (r: GradedRun) => (models.length > 1 ? `${r.harness} / ${r.model}` : r.harness);
  const columns = uniq(
    summaries.flatMap((s) =>
      models.length > 1 ? s.harnesses.map((h) => `${h} / ${s.model}`) : s.harnesses,
    ),
  );
  const sum = (f: (s: Summary) => number) => summaries.reduce((n, s) => n + f(s), 0);
  const cost = sum((s) => s.usage.costUsd + s.judge.costUsd);
  const tokens = sum(
    (s) => s.usage.inputTokens + s.usage.outputTokens + s.judge.inputTokens + s.judge.outputTokens,
  );
  const judgeCost = sum((s) => s.judge.costUsd);
  const row = (cells: string[]) => `| ${cells.join(' | ')} |`;
  const table = (head: string[], body: string[][]) => [
    row(head),
    row(head.map(() => '---')),
    ...body.map(row),
  ];

  const out = [
    '# Eval report',
    '',
    `- Date: ${uniq(summaries.map((s) => s.startedAt.slice(0, 10))).join(', ')}`,
    `- Agent model: ${models.join(', ')}`,
    `- Judge model: ${uniq(summaries.map((s) => s.judgeModel)).join(', ')} (${sum((s) => s.judge.calls)} calls, $${judgeCost.toFixed(4)})`,
    `- Harnesses: ${uniq(summaries.flatMap((s) => s.harnesses)).join(', ')}`,
    `- Runs per case: ${uniq(summaries.map((s) => s.runs)).join(', ')}`,
    `- Total cost: $${cost.toFixed(4)} (agent plus judge)`,
    `- Total tokens: ${tokens}`,
    `- Pricing date: ${uniq(summaries.map((s) => s.pricingDate)).join(', ')}`,
    ...summaries.filter((s) => s.stopped).map((s) => `- Stopped early (${s.model}): ${s.stopped}`),
    '',
    '`na` dimensions do not count against a run. The `none` harness cannot call tools, so its tool',
    'selection and arguments are always `na`. `asked n` counts runs that asked a question where',
    'the case accepts one (`accept_question`).',
    '',
    '## Pass rate by category',
    '',
  ];

  const rate = (rs: GradedRun[], col: string) => {
    const mine = rs.filter((r) => colOf(r) === col);
    return mine.length ? pct(mine.filter((r) => r.grade.overall).length, mine.length) : '-';
  };
  const present = categories.filter((cat) => runs.some((r) => r.category === cat));
  out.push(
    ...table(
      ['Category', ...columns],
      [
        ...present.map((cat) => [
          cat,
          ...columns.map((col) =>
            rate(
              runs.filter((r) => r.category === cat),
              col,
            ),
          ),
        ]),
        ['all', ...columns.map((col) => rate(runs, col))],
      ],
    ),
  );

  out.push('', '## Per case', '');
  const caseIds = uniq(runs.map((r) => r.caseId));
  out.push(
    ...table(
      ['Case', 'Category', 'Evidence', ...columns],
      caseIds.map((id) => {
        const rs = runs.filter((r) => r.caseId === id);
        return [
          id,
          rs[0]!.category,
          cell(rs[0]!.evidence ?? ''),
          ...columns.map((col) => {
            const mine = rs.filter((r) => colOf(r) === col);
            if (!mine.length) return '-';
            const failed = uniq(
              mine.flatMap((r) => dimensions.filter((d) => r.grade[d] === 'fail')),
            );
            const passes = mine.filter((r) => r.grade.overall).length;
            const asked = mine.filter((r) => r.grade.asked).length;
            const notes = [...failed, ...(asked ? [`asked ${asked}`] : [])];
            return `${passes}/${mine.length}${notes.length ? ` (${notes.join(', ')})` : ''}`;
          }),
        ];
      }),
    ),
  );

  const failures = runs.filter((r) => !r.grade.overall);
  out.push('', '## Failures', '');
  if (!failures.length) out.push('None.');
  for (const r of failures)
    out.push(
      `### ${r.caseId} / ${colOf(r)} / run ${r.run}`,
      '',
      ...r.grade.details.map((d) => `- ${d}`),
      '',
      `> ${cell(r.finalText.slice(0, 300))}`,
      '',
    );
  return out.join('\n').trimEnd() + '\n';
}

/** Writes summary.json and report.md into dir. */
export function writeResults(dir: string, summary: Summary & Record<string, unknown>) {
  writeFileSync(resolve(dir, 'summary.json'), JSON.stringify(summary, null, 2));
  writeFileSync(resolve(dir, 'report.md'), renderReport([summary]));
}
