import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import type { PaperConfig } from '../src/core/types';

const paperDir = fileURLToPath(new URL('.', import.meta.url));
function contextSource(season: string, division: 'junior' | 'senior', contextId: string): string {
  const paper = JSON.parse(readFileSync(join(paperDir, `${season}-${division}.json`), 'utf8')) as PaperConfig;
  const context = paper.contexts?.find((item) => item.id === contextId);
  if (!context?.displayCode) throw new Error(`Missing shared code: ${season} ${division} ${contextId}`);
  const source = context.displayCode.cpp ?? context.displayCode.c ?? context.displayCode.python;
  if (!source) throw new Error(`Empty shared code: ${season} ${division} ${contextId}`);
  return source.replace(/{{[^}]+}}/g, '{{blank}}').replace(/\s+/g, '');
}

it.each([
  ['2014', 'q5-code', 'q5'],
  ['2015-16', 'crosses', 'crosses'],
  ['2016-17', 'q4-recursive', 'palindrome-recursive'],
  ['2017-18', 'q2-code', 'reverse'],
  ['2017-18', 'q7-code', 'primes'],
  ['2018-19', 'q2d-code', 'factor-classification']
])('shows the same printed code in both divisions for %s', (season, juniorId, seniorId) => {
  expect(contextSource(season, 'junior', juniorId)).toBe(contextSource(season, 'senior', seniorId));
});

it('preserves the header printed only in the 2012 Junior version', () => {
  expect(contextSource('2012', 'junior', 'q2-code'))
    .toBe(`#include<stdio.h>${contextSource('2012', 'senior', 'section-b-q2')}`);
});
