import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateManifest, validateRepository } from './validate-catalog.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => path.join(here, 'fixtures', name);
const script = path.join(here, 'validate-catalog.mjs');

test('a valid catalog has no errors', () => {
  assert.deepEqual(validateRepository(fixture('valid')), []);
});

test('an invalid catalog reports each problem', () => {
  const errors = validateRepository(fixture('invalid'));
  const expected = [
    'catalog.json.default: must be the ID of a listed layout',
    'layouts/stray: folder is not listed in catalog.json',
    'layouts/broken/Dockerfile: file is missing',
    'layouts/broken/layout.json.id: "other" does not match catalog ID "broken"',
    'unknown field "colour"',
    '.entry: use a relative HTML entry page',
    '.network: must be "none" or "bridge"',
    '.memory_mb: must be an integer from 128 to 1024',
    'settings[0].default: secrets cannot have manifest defaults',
    'settings[1]: a choice setting needs choices',
    'key "csrf" conflicts with host form metadata',
    'settings[3]: list field keys must be unique',
    'settings[4].type: must be one of',
    'settings: setting keys must be unique',
  ];
  for (const text of expected) {
    assert.ok(errors.some((error) => error.includes(text)), `missing error: ${text}\n${errors.join('\n')}`);
  }
});

test('manifest defaults match the host defaults', () => {
  assert.deepEqual(validateManifest({ id: 'minimal', name: 'Minimal' }), []);
  assert.ok(validateManifest({ id: 'Bad', name: '' }).length === 2);
});

test('a null setting default is rejected like the host does', () => {
  const errors = validateManifest({ id: 'minimal', name: 'Minimal', settings: [{ key: 'title', label: 'Title', type: 'text', default: null }] });
  assert.ok(errors.some((error) => error.includes('settings[0].default: must be a string or boolean')), errors.join('\n'));
});

const showCalendar = { key: 'show_calendar', type: 'boolean', default: true, label: 'Show the calendar', description: 'Turn this off to show only artwork.', badge: 'Calendar off' };
const withDisplay = (display_settings, settings = []) => validateManifest({ id: 'minimal', name: 'Minimal', settings, display_settings });
const hasError = (errors, text) => assert.ok(errors.some((error) => error.includes(text)), `missing error: ${text}\n${errors.join('\n')}`);

test('a valid display setting has no errors', () => {
  assert.deepEqual(withDisplay([showCalendar]), []);
  assert.deepEqual(withDisplay([{ key: 'dim', type: 'boolean', label: 'Dim' }]), []);
});

test('display settings report each problem', () => {
  hasError(withDisplay([{ ...showCalendar, type: 'checkbox' }]), 'display_settings[0].type: must be "boolean"');
  hasError(withDisplay([{ key: 'dim', label: 'Dim' }]), 'display_settings[0].type: is required');
  hasError(withDisplay([{ ...showCalendar, default: 'yes' }]), 'display_settings[0].default: must be true or false');
  hasError(withDisplay([{ ...showCalendar, default: null }]), 'display_settings[0].default: must be true or false');
  hasError(withDisplay([showCalendar, showCalendar]), 'display_settings: keys must be unique');
  hasError(withDisplay([showCalendar], [{ key: 'show_calendar', label: 'Show', type: 'checkbox', default: true }]), 'key "show_calendar" is already a settings key');
  hasError(withDisplay([{ ...showCalendar, colour: 'red' }]), 'display_settings[0]: unknown field "colour"');
  hasError(withDisplay([{ ...showCalendar, badge: 'x'.repeat(31) }]), 'display_settings[0].badge: must have at most 30 characters');
  hasError(withDisplay([{ ...showCalendar, key: 'Show' }]), 'display_settings[0].key: must match');
  hasError(withDisplay([{ ...showCalendar, label: '' }]), 'display_settings[0].label: must have at least 1');
  hasError(withDisplay(Array.from({ length: 11 }, (_, index) => ({ key: `k${index}`, type: 'boolean', label: 'K' }))), 'display_settings: must have at most 10 items');
});

test('the command exits non-zero for an invalid catalog', () => {
  const bad = spawnSync(process.execPath, [script, fixture('invalid')], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Catalog validation failed/);
  const good = spawnSync(process.execPath, [script, fixture('valid')], { encoding: 'utf8' });
  assert.equal(good.status, 0, good.stderr);
  assert.match(good.stdout, /Catalog is valid: 1 layout/);
});
