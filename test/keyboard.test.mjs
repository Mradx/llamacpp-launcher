import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesShortcut } from '../dist/utils/keyboard.js';

test('matches latin shortcut keys on Russian keyboard layout', () => {
  assert.equal(matchesShortcut('y', 'y'), true);
  assert.equal(matchesShortcut('Y', 'y'), true);
  assert.equal(matchesShortcut('\u043d', 'y'), true);
  assert.equal(matchesShortcut('\u041d', 'y'), true);

  assert.equal(matchesShortcut('\u0442', 'n'), true);
  assert.equal(matchesShortcut('\u0422', 'n'), true);
  assert.equal(matchesShortcut('\u0448', 'i'), true);
  assert.equal(matchesShortcut('\u043a', 'r'), true);
  assert.equal(matchesShortcut('\u0439', 'q'), true);
  assert.equal(matchesShortcut('\u0434', 'l'), true);
  assert.equal(matchesShortcut('\u0445', '['), true);
  assert.equal(matchesShortcut('\u044d', "'"), true);
  assert.equal(matchesShortcut('.', '/'), true);
});

test('does not match a Russian character from another physical key', () => {
  assert.equal(matchesShortcut('\u043d', 'n'), false);
  assert.equal(matchesShortcut('\u0442', 'y'), false);
});
