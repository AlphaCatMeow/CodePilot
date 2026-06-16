import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { promptNeedsMedia } from '@/lib/media-intent';
import { getBuiltinTools } from '@/lib/builtin-tools';

const REPO_ROOT = path.resolve(__dirname, '../../..');

describe('promptNeedsMedia', () => {
  it('detects Chinese poster/image generation phrasing', () => {
    assert.equal(
      promptNeedsMedia('生成一张海报图，主题是凤凰传奇演唱会即将在上海体育场举办'),
      true,
    );
    assert.equal(promptNeedsMedia('帮我生图：赛博朋克城市夜景'), true);
    assert.equal(promptNeedsMedia('文生图，做一张公众号封面'), true);
    assert.equal(promptNeedsMedia('画一张小猫图'), true);
  });

  it('detects media intent from conversation history', () => {
    assert.equal(
      promptNeedsMedia('继续', [{ content: '上一轮请你生成一张海报' }]),
      true,
    );
  });

  it('does not classify ordinary code questions as media requests', () => {
    assert.equal(promptNeedsMedia('解释一下这个 TypeScript 类型错误'), false);
    assert.equal(promptNeedsMedia('运行单元测试并查看失败原因'), false);
  });
});

describe('Native media tool context wiring', () => {
  it('passes sessionId and workspacePath into createMediaTools', () => {
    const src = fs.readFileSync(
      path.join(REPO_ROOT, 'src/lib/builtin-tools/index.ts'),
      'utf-8',
    );
    assert.match(
      src,
      /createMediaTools\(\s*\{\s*sessionId:\s*options\.sessionId,\s*workingDirectory:\s*options\.workspacePath,\s*\}\s*\)/,
    );
  });

  it('includes image generation tools for poster prompts', () => {
    const { tools } = getBuiltinTools({
      workspacePath: REPO_ROOT,
      prompt: '生成一张海报图，主题是凤凰传奇演唱会即将在上海体育场举办',
      sessionId: 'media-intent-test',
    });
    assert.ok(tools.codepilot_generate_image);
    assert.ok(tools.codepilot_import_media);
  });
});
