#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appTsx = fs.readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8');
const appCss = fs.readFileSync(path.join(root, 'src', 'App.css'), 'utf8');

const requiredAppTokens = [
  'easy-openclaw',
  'Setup',
  'Run',
  'Diagnostics',
  'モデルを追加',
  '現在のモデルはありません。',
  'Add Model',
  'Update Model',
  'Save Channel',
  'Add Agent',
  'Save Agent writes to draft state. Run Apply to write files.',
  'External chat integration is optional.',
  'OpenClaw runtime server settings.',
  'Security',
  'Apply Config',
  'Start',
  'Stop',
  'Open Dashboard',
  'TCC Experiment',
];

const requiredCssTokens = [
  '--bg-deep',
  '--coral-bright',
  '--cyan-bright',
  '--font-display',
  '--font-body',
  '.top-bar',
  '.tab-row',
  '.tab-panel',
  '.panel',
  '@media (max-width: 760px)',
];

const missingApp = requiredAppTokens.filter((t) => !appTsx.includes(t));
const missingCss = requiredCssTokens.filter((t) => !appCss.includes(t));

if (missingApp.length || missingCss.length) {
  console.error('UI regression check failed');
  if (missingApp.length) {
    console.error(`missing App.tsx tokens: ${missingApp.join(', ')}`);
  }
  if (missingCss.length) {
    console.error(`missing App.css tokens: ${missingCss.join(', ')}`);
  }
  process.exit(1);
}

console.log('UI regression check: ok');
