import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRawArgsInput, parseRawArgs } from '../dist/services/known-params.js';

const expectedSamplingArgs = [
  '--temp', '1.0',
  '--top-p', '0.95',
  '--top-k', '20',
  '--presence-penalty', '1.5',
  '--min-p', '0.00',
];

test('parses multi-line args without explicit continuations', () => {
  assert.deepEqual(parseRawArgs(`
    --temp 1.0
    --top-p 0.95
    --top-k 20
    --presence-penalty 1.5
    --min-p 0.00
  `), expectedSamplingArgs);
});

test('parses mixed one-line and multi-line args', () => {
  assert.deepEqual(
    parseRawArgs('--temp 1.0 --top-p 0.95 --top-k 20 \n--presence-penalty 1.5 --min-p 0.00'),
    expectedSamplingArgs,
  );
});

test('removes shell line continuations before parsing', () => {
  assert.deepEqual(parseRawArgs(
    '--temp 1.0 \\\n' +
    '--top-p 0.95 \\\n' +
    '--top-k 20 \\\n' +
    '--presence-penalty 1.5 \\\n' +
    '--min-p 0.00',
  ), expectedSamplingArgs);

  assert.deepEqual(parseRawArgs(
    '--temp 1.0 `\n' +
    '--top-p 0.95 `\n' +
    '--top-k 20 `\n' +
    '--presence-penalty 1.5 `\n' +
    '--min-p 0.00',
  ), expectedSamplingArgs);
});

test('normalizes continuation blocks into a valid single-line command fragment', () => {
  assert.equal(
    normalizeRawArgsInput(' --temp 1.0 \\\r\n   --top-p 0.95 `\n--top-k 20 '),
    '--temp 1.0 --top-p 0.95 --top-k 20',
  );
});

test('keeps quoted values together', () => {
  assert.deepEqual(
    parseRawArgs('--grammar "root ::= item" --json-schema \'{"type":"object"}\''),
    ['--grammar', 'root ::= item', '--json-schema', '{"type":"object"}'],
  );
});
