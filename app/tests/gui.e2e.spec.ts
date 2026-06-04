import { expect, test } from '@playwright/test';

test('Setup/Run/Diagnostics tabs are navigable', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'easy-openclaw' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Setup' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Diagnostics' })).toBeVisible();

  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByRole('heading', { name: 'Run' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Logs' })).toBeVisible();

  await page.getByRole('button', { name: 'Diagnostics' }).click();
  await expect(page.getByRole('heading', { name: 'TCC Experiment' })).toBeVisible();

  await page.getByRole('button', { name: 'Setup' }).click();
  await expect(page.getByRole('heading', { name: 'Models' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Channels' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Apply' })).toBeVisible();
});

test('Setup forms accept input and render controls', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: /モデルを追加|Add Model/ }).click();
  await page.getByLabel('Provider').selectOption('lm_studio');
  await expect(page.getByLabel('Provider')).toHaveValue('lm_studio');
  await page.getByLabel('Provider').selectOption('open_ai');
  await page.getByLabel('Provider').selectOption('anthropic');
  await page.getByLabel('Provider').selectOption('google');
  await page.getByLabel('Provider').selectOption('lm_studio');
  await expect(page.getByLabel('Provider')).toHaveValue('lm_studio');
  await page.getByLabel('Base URL').fill('http://127.0.0.1:1234/v1');
  await page.getByLabel('Model Name').fill('openai/gpt-oss-20b');
  await expect(page.getByLabel('Model Editor').getByRole('button', { name: 'Add Model' })).toBeVisible();
  await page.getByRole('button', { name: /閉じる|Close/ }).click();

  await page.getByRole('button', { name: /チャンネルを追加|Add Channel/ }).click();
  await page.getByLabel('Slack Bot Token').fill('xoxb-test-token');
  await page.getByLabel('Slack App Token').fill('xapp-test-token');
  await expect(page.getByRole('button', { name: 'Save Channel' })).toBeVisible();
  await page.getByRole('button', { name: /閉じる|Close/ }).click();

  await page.getByRole('button', { name: /エージェントを追加|Add Agent/ }).click();
  await page.getByLabel('Agent ID').fill('agent-e2e');
  await expect(page.getByLabel('Agent Editor').getByRole('button', { name: /Agentを保存|Save Agent/ })).toBeVisible();
  await page.getByRole('button', { name: /閉じる|Close/ }).click();

  await expect(page.getByRole('button', { name: 'Apply Config' })).toBeVisible();
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();

  await page.getByRole('button', { name: 'Diagnostics' }).click();
  await page.getByLabel('Case ID').fill('case-a');
  await page.getByLabel('Note').fill('gui-e2e-check');
  await expect(page.getByRole('button', { name: 'Save Record' })).toBeVisible();
});
