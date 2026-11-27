#!/usr/bin/env node
// Validate catalog.json and every layouts/<id>/layout.json in this repository.
//
// This check is stricter than the host on purpose: it rejects some catalogs
// that the host accepts. For example, it requires `default`, a `name` that
// matches layout.json, a path of layouts/<id>, and a catalog entry for every
// layout folder. Do not relax a rule only because the host allows it. It does not
// check package files (symlinks, private files); the host's
// `install-layout.py --check` does.
//
// The manifest rules mirror the host's pydantic models in
// ../art-frames/art_frames/layouts.py (Manifest, Setting, DisplaySetting, LegacyItem,
// setting_value)
// and ../art-frames/art_frames/config.py (clock, extra="forbid"). The catalog rules
// mirror ../art-frames/scripts/install-layout.py. Keep this file in sync when the
// host changes. It also does not coerce types as pydantic does (for example,
// "512" is not accepted as a number).
//
// Usage: node scripts/validate-catalog.mjs [repository-root]
// Plain Node only. No dependencies.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MANIFEST_MAX_BYTES = 50_000; // LayoutStore.manifest
const SETTING_VALUE_MAX = 4096; // setting_value
const KEY = /^[a-z][a-z0-9_]{0,63}$/;
const LAYOUT_ID = /^[a-z][a-z0-9-]{0,63}$/;
const ROW_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ENTRY = /^[A-Za-z0-9_/-]+\.html$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const TYPES = ['text', 'secret', 'choice', 'time', 'checkbox', 'color', 'list'];

const MANIFEST_FIELDS = ['schema_version', 'id', 'name', 'description', 'entry', 'network', 'memory_mb', 'artwork', 'settings', 'display_settings'];
const SETTING_FIELDS = ['key', 'label', 'type', 'description', 'default', 'choices', 'fields', 'max_items', 'item_label', 'legacy_items'];
const DISPLAY_SETTING_FIELDS = ['key', 'type', 'label', 'description', 'default', 'badge'];
const LEGACY_FIELDS = ['id', 'values', 'copy_from'];

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isInt = (value) => typeof value === 'number' && Number.isInteger(value);
// pydantic counts code points, not UTF-16 units.
const length = (value) => [...value].length;

function unknownFields(value, allowed, where, errors) {
  for (const name of Object.keys(value)) {
    if (!allowed.includes(name)) errors.push(`${where}: unknown field "${name}"`);
  }
}

function checkString(value, where, errors, { min = 0, max, pattern, required = false } = {}) {
  if (value === undefined) {
    if (required) errors.push(`${where}: is required`);
    return false;
  }
  if (typeof value !== 'string') {
    errors.push(`${where}: must be a string`);
    return false;
  }
  if (length(value) < min) errors.push(`${where}: must have at least ${min} character(s)`);
  if (max !== undefined && length(value) > max) errors.push(`${where}: must have at most ${max} characters`);
  if (pattern && !pattern.test(value)) errors.push(`${where}: must match ${pattern}`);
  return true;
}

function checkList(value, where, errors, max) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push(`${where}: must be an array`);
    return [];
  }
  if (value.length > max) errors.push(`${where}: must have at most ${max} items`);
  return value;
}

// Mirrors layouts.setting_value for manifest-supplied values (legacy item values).
function checkValue(setting, value, where, errors) {
  if (typeof value !== 'string' && typeof value !== 'boolean') {
    errors.push(`${where}: must be a string or boolean`);
    return;
  }
  if (typeof value === 'string' && length(value) > SETTING_VALUE_MAX) {
    errors.push(`${where}: exceeds ${SETTING_VALUE_MAX} characters`);
  }
  if (setting.type === 'checkbox') {
    if (typeof value !== 'boolean') errors.push(`${where}: a checkbox needs a boolean`);
    return;
  }
  if (typeof value !== 'string') {
    errors.push(`${where}: this setting needs text`);
    return;
  }
  if (setting.type === 'choice' && !(setting.choices || []).includes(value)) {
    errors.push(`${where}: "${value}" is not one of the choices`);
  }
  if (setting.type === 'time' && !CLOCK.test(value)) errors.push(`${where}: use a time in HH:MM format`);
  if (setting.type === 'color' && !COLOR.test(value)) errors.push(`${where}: use a six-digit hexadecimal color`);
}

function checkLegacyItem(row, where, errors) {
  if (!isObject(row)) {
    errors.push(`${where}: must be an object`);
    return false;
  }
  unknownFields(row, LEGACY_FIELDS, where, errors);
  checkString(row.id, `${where}.id`, errors, { pattern: ROW_ID, required: true });
  let valid = true;
  for (const name of ['values', 'copy_from']) {
    if (row[name] === undefined) continue;
    if (!isObject(row[name])) {
      errors.push(`${where}.${name}: must be an object`);
      valid = false;
      continue;
    }
    for (const [key, value] of Object.entries(row[name])) {
      const ok = name === 'values' ? typeof value === 'string' || typeof value === 'boolean' : typeof value === 'string';
      if (!ok) {
        errors.push(`${where}.${name}.${key}: must be ${name === 'values' ? 'a string or boolean' : 'a string'}`);
        valid = false;
      }
    }
  }
  return valid;
}

// Mirrors layouts.Setting, including its valid_default validator.
function checkSetting(setting, where, errors) {
  if (!isObject(setting)) {
    errors.push(`${where}: must be an object`);
    return;
  }
  unknownFields(setting, SETTING_FIELDS, where, errors);
  checkString(setting.key, `${where}.key`, errors, { pattern: KEY, required: true });
  checkString(setting.label, `${where}.label`, errors, { min: 1, max: 100, required: true });
  if (setting.type === undefined) errors.push(`${where}.type: is required`);
  else if (!TYPES.includes(setting.type)) errors.push(`${where}.type: must be one of ${TYPES.join(', ')}`);
  checkString(setting.description, `${where}.description`, errors, { max: 500 });
  // The host's default is str | bool, so null is invalid, not missing.
  const fallback = setting.default === undefined ? '' : setting.default;
  if (typeof fallback !== 'string' && typeof fallback !== 'boolean') {
    errors.push(`${where}.default: must be a string or boolean`);
  }
  const choices = checkList(setting.choices, `${where}.choices`, errors, 30);
  choices.forEach((choice, index) => {
    if (typeof choice !== 'string') errors.push(`${where}.choices[${index}]: must be a string`);
  });
  const fields = checkList(setting.fields, `${where}.fields`, errors, 8);
  fields.forEach((field, index) => checkSetting(field, `${where}.fields[${index}]`, errors));
  if (setting.max_items !== undefined && (!isInt(setting.max_items) || setting.max_items < 1 || setting.max_items > 12)) {
    errors.push(`${where}.max_items: must be an integer from 1 to 12`);
  }
  checkString(setting.item_label, `${where}.item_label`, errors, { min: 1, max: 60 });
  const legacy = checkList(setting.legacy_items, `${where}.legacy_items`, errors, 12);
  const legacyValid = legacy.map((row, index) => checkLegacyItem(row, `${where}.legacy_items[${index}]`, errors));

  if (setting.type === 'list') {
    if (!fields.length || fallback || fields.some((field) => field?.type === 'list')) {
      errors.push(`${where}: a list needs scalar fields and no default`);
    }
    const keys = fields.map((field) => field?.key);
    if (new Set(keys).size !== keys.length || keys.some((key) => key === 'id' || (typeof key === 'string' && key.startsWith('clear_')))) {
      errors.push(`${where}: list field keys must be unique and must not be "id" or start with "clear_"`);
    }
    const maxItems = isInt(setting.max_items) ? setting.max_items : 8;
    const ids = legacy.map((row) => row?.id);
    if (legacy.length > maxItems || new Set(ids).size !== ids.length) {
      errors.push(`${where}.legacy_items: must have unique IDs and no more than max_items rows`);
    }
    legacy.forEach((row, index) => {
      if (!legacyValid[index]) return;
      const at = `${where}.legacy_items[${index}]`;
      const values = row.values || {};
      const copyFrom = row.copy_from || {};
      for (const key of [...Object.keys(values), ...Object.keys(copyFrom)]) {
        if (!keys.includes(key)) errors.push(`${at}: "${key}" is not a declared field`);
      }
      for (const field of fields) {
        if (!isObject(field)) continue;
        if (field.key in copyFrom && field.type !== 'secret') {
          errors.push(`${at}.copy_from.${field.key}: legacy private values can only migrate into secret fields`);
        }
        if (field.key in values) {
          if (field.type === 'secret' && values[field.key]) {
            errors.push(`${at}.values.${field.key}: secrets cannot have manifest defaults`);
          }
          checkValue(field, values[field.key], `${at}.values.${field.key}`, errors);
        }
      }
    });
    return;
  }
  if (fields.length || legacy.length) errors.push(`${where}: only lists can declare fields or legacy_items`);
  if (setting.type !== 'checkbox' && typeof fallback !== 'string') errors.push(`${where}.default: this setting needs a text default`);
  if (setting.type === 'secret' && fallback) errors.push(`${where}.default: secrets cannot have manifest defaults`);
  if (setting.type === 'choice' && (!choices.length || !choices.includes(fallback))) {
    errors.push(`${where}: a choice setting needs choices and a default that is one of them`);
  }
  if (setting.type === 'checkbox' && typeof fallback !== 'boolean') errors.push(`${where}.default: a checkbox setting needs a boolean default`);
  if (setting.type === 'time' && typeof fallback === 'string' && !CLOCK.test(fallback)) {
    errors.push(`${where}.default: use a time in HH:MM format`);
  }
  if (setting.type === 'color' && typeof fallback === 'string' && !COLOR.test(fallback)) {
    errors.push(`${where}.default: use a six-digit hexadecimal color`);
  }
}

// Mirrors layouts.DisplaySetting: a per-TV switch. Only booleans exist for now.
function checkDisplaySetting(setting, where, errors) {
  if (!isObject(setting)) {
    errors.push(`${where}: must be an object`);
    return;
  }
  unknownFields(setting, DISPLAY_SETTING_FIELDS, where, errors);
  checkString(setting.key, `${where}.key`, errors, { pattern: KEY, required: true });
  if (setting.type === undefined) errors.push(`${where}.type: is required`);
  else if (setting.type !== 'boolean') errors.push(`${where}.type: must be "boolean"`);
  checkString(setting.label, `${where}.label`, errors, { min: 1, max: 100, required: true });
  checkString(setting.description, `${where}.description`, errors, { max: 500 });
  // The host's default is bool, so null is invalid, not missing.
  if (setting.default !== undefined && typeof setting.default !== 'boolean') {
    errors.push(`${where}.default: must be true or false`);
  }
  checkString(setting.badge, `${where}.badge`, errors, { max: 30 });
}

// Mirrors layouts.Manifest. Returns a list of error strings.
export function validateManifest(manifest, where = 'layout.json') {
  const errors = [];
  if (!isObject(manifest)) return [`${where}: must be a JSON object`];
  unknownFields(manifest, MANIFEST_FIELDS, where, errors);
  if (manifest.schema_version !== undefined && manifest.schema_version !== 1) {
    errors.push(`${where}.schema_version: must be 1`);
  }
  checkString(manifest.id, `${where}.id`, errors, { pattern: LAYOUT_ID, required: true });
  checkString(manifest.name, `${where}.name`, errors, { min: 1, max: 100, required: true });
  checkString(manifest.description, `${where}.description`, errors, { max: 500 });
  if (checkString(manifest.entry, `${where}.entry`, errors)) {
    const entry = manifest.entry;
    if (!ENTRY.test(entry) || entry.split('/').includes('..') || entry.startsWith('/')) {
      errors.push(`${where}.entry: use a relative HTML entry page, for example index.html`);
    }
  }
  if (manifest.network !== undefined && manifest.network !== 'none' && manifest.network !== 'bridge') {
    errors.push(`${where}.network: must be "none" or "bridge"`);
  }
  if (manifest.memory_mb !== undefined && (!isInt(manifest.memory_mb) || manifest.memory_mb < 128 || manifest.memory_mb > 1024)) {
    errors.push(`${where}.memory_mb: must be an integer from 128 to 1024`);
  }
  if (manifest.artwork !== undefined && typeof manifest.artwork !== 'boolean') {
    errors.push(`${where}.artwork: must be true or false`);
  }
  const settings = checkList(manifest.settings, `${where}.settings`, errors, 30);
  settings.forEach((setting, index) => checkSetting(setting, `${where}.settings[${index}]`, errors));
  const keys = settings.map((setting) => setting?.key);
  if (new Set(keys).size !== keys.length) errors.push(`${where}.settings: setting keys must be unique`);
  for (const key of keys) {
    if (key === 'csrf' || key === 'manifest' || (typeof key === 'string' && key.startsWith('clear_'))) {
      errors.push(`${where}.settings: key "${key}" conflicts with host form metadata`);
    }
  }
  const display = checkList(manifest.display_settings, `${where}.display_settings`, errors, 10);
  display.forEach((setting, index) => checkDisplaySetting(setting, `${where}.display_settings[${index}]`, errors));
  const displayKeys = display.map((setting) => setting?.key);
  if (new Set(displayKeys).size !== displayKeys.length) errors.push(`${where}.display_settings: keys must be unique`);
  for (const key of new Set(displayKeys)) {
    if (typeof key === 'string' && keys.includes(key)) errors.push(`${where}.display_settings: key "${key}" is already a settings key`);
  }
  return errors;
}

function readJson(file, label, errors) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    errors.push(`${label}: ${error.code === 'ENOENT' ? 'file is missing' : `invalid JSON (${error.message})`}`);
    return undefined;
  }
}

// Checks catalog.json, each listed layout, and stray layout folders. Returns error strings.
export function validateRepository(root) {
  const errors = [];
  const catalog = readJson(path.join(root, 'catalog.json'), 'catalog.json', errors);
  if (catalog === undefined) return errors;
  if (!isObject(catalog)) return ['catalog.json: must be a JSON object'];
  if (catalog.schema_version !== 1) errors.push('catalog.json.schema_version: must be 1');
  if (!Array.isArray(catalog.layouts) || !catalog.layouts.length) {
    errors.push('catalog.json.layouts: must be a non-empty array');
    return errors;
  }
  const ids = new Set();
  catalog.layouts.forEach((item, index) => {
    const where = `catalog.json.layouts[${index}]`;
    if (!isObject(item)) {
      errors.push(`${where}: must be an object`);
      return;
    }
    if (!checkString(item.id, `${where}.id`, errors, { pattern: LAYOUT_ID, required: true })) return;
    checkString(item.name, `${where}.name`, errors, { min: 1, max: 100, required: true });
    if (ids.has(item.id)) errors.push(`${where}.id: duplicate ID "${item.id}"`);
    ids.add(item.id);
    const expected = `layouts/${item.id}`;
    if (item.path !== expected) errors.push(`${where}.path: must be "${expected}"`);
    const dir = path.join(root, 'layouts', item.id);
    const label = `${expected}/layout.json`;
    const file = path.join(dir, 'layout.json');
    if (fs.existsSync(file) && fs.statSync(file).size > MANIFEST_MAX_BYTES) {
      errors.push(`${label}: must be at most ${MANIFEST_MAX_BYTES} bytes`);
    }
    const manifest = readJson(file, label, errors);
    if (manifest !== undefined) {
      errors.push(...validateManifest(manifest, label));
      if (isObject(manifest) && manifest.id !== item.id) {
        errors.push(`${label}.id: "${manifest.id}" does not match catalog ID "${item.id}"`);
      }
      if (isObject(manifest) && typeof item.name === 'string' && manifest.name !== item.name) {
        errors.push(`${label}.name: "${manifest.name}" does not match catalog name "${item.name}"`);
      }
    }
    if (!fs.existsSync(path.join(dir, 'Dockerfile'))) errors.push(`${expected}/Dockerfile: file is missing (the installer requires it)`);
  });
  if (typeof catalog.default !== 'string' || !ids.has(catalog.default)) {
    errors.push('catalog.json.default: must be the ID of a listed layout');
  }
  const layoutsDir = path.join(root, 'layouts');
  if (fs.existsSync(layoutsDir)) {
    for (const entry of fs.readdirSync(layoutsDir, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && !ids.has(entry.name)) {
        errors.push(`layouts/${entry.name}: folder is not listed in catalog.json`);
      }
    }
  }
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const errors = validateRepository(root);
  if (errors.length) {
    console.error(`Catalog validation failed with ${errors.length} error(s):`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  const count = JSON.parse(fs.readFileSync(path.join(root, 'catalog.json'), 'utf8')).layouts.length;
  console.log(`Catalog is valid: ${count} layout(s) checked.`);
}
