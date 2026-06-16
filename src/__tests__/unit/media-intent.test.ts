import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  parseDirectImageGenerationRequest,
  promptNeedsMedia,
} from '@/lib/media-intent';
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

describe('parseDirectImageGenerationRequest', () => {
  it('parses explicit native image tool requests without leaking control words into prompt', () => {
    const parsed = parseDirectImageGenerationRequest(
      '请直接调用 codepilot_generate_image 工具生成图片。提示词：凤凰传奇演唱会即将在上海体育场举办的9:16海报图。',
    );

    assert.ok(parsed);
    assert.equal(parsed.aspectRatio, '9:16');
    assert.equal(parsed.prompt, '凤凰传奇演唱会即将在上海体育场举办的海报图。');
  });

  it('ignores ordinary image prompts so natural-language routing stays separate', () => {
    assert.equal(
      parseDirectImageGenerationRequest('生成一张海报图，主题是凤凰传奇演唱会即将在上海体育场举办'),
      null,
    );
  });
});

describe('Direct chat image generation route', () => {
  it('short-circuits explicit codepilot_generate_image requests before streamClaude', () => {
    const src = fs.readFileSync(
      path.join(REPO_ROOT, 'src/app/api/chat/route.ts'),
      'utf-8',
    );
    assert.match(src, /parseDirectImageGenerationRequest\(content\)/);
    assert.match(src, /generateSingleImage\(\{\s*prompt:\s*directImageRequest\.prompt[\s\S]*abortSignal:\s*abortController\.signal/);
    assert.match(src, /name:\s*'codepilot_generate_image'/);
    assert.match(src, /sourceMetadata:\s*\{\s*prompt:\s*directImageRequest\.prompt,\s*model:\s*result\.model/);
    assert.match(src, /sseEvent\('tool_result',\s*JSON\.stringify\(toolResultBlock\)\)/);
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
