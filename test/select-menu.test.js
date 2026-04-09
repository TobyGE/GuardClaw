import { test } from 'node:test';
import * as assert from 'node:assert';

import { getMenuPageSize, getMenuViewport } from '../bin/select-menu.js';

test('getMenuPageSize reserves space for menu chrome', () => {
  assert.strictEqual(getMenuPageSize(50, 12, 1), 7);
  assert.strictEqual(getMenuPageSize(3, 12, 1), 3);
  assert.strictEqual(getMenuPageSize(1, undefined, 0), 1);
});

test('getMenuViewport keeps cursor within the visible window', () => {
  assert.deepStrictEqual(
    getMenuViewport(50, 0, 6, 0),
    {
      offset: 0,
      start: 0,
      end: 6,
      pageSize: 6,
      hasOverflow: true,
      above: 0,
      below: 44,
    },
  );

  assert.deepStrictEqual(
    getMenuViewport(50, 7, 6, 0),
    {
      offset: 2,
      start: 2,
      end: 8,
      pageSize: 6,
      hasOverflow: true,
      above: 2,
      below: 42,
    },
  );

  assert.deepStrictEqual(
    getMenuViewport(50, 49, 6, 40),
    {
      offset: 44,
      start: 44,
      end: 50,
      pageSize: 6,
      hasOverflow: true,
      above: 44,
      below: 0,
    },
  );
});

test('getMenuViewport collapses to the full list when it already fits', () => {
  assert.deepStrictEqual(
    getMenuViewport(4, 2, 10, 0),
    {
      offset: 0,
      start: 0,
      end: 4,
      pageSize: 4,
      hasOverflow: false,
      above: 0,
      below: 0,
    },
  );
});
