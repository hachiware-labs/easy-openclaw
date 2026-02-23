#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const appTsx = fs.readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8');
const appCss = fs.readFileSync(path.join(root, 'src', 'App.css'), 'utf8');

const requiredAppTokens = [
  'EasyClaw',
  'Setup',
  'Run',
  'Diagnostics',
  'モデルを追加',
  '現在のモデルはありません。',
  'Save Model',
  'Save Channel',
  'Save Agent',
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
