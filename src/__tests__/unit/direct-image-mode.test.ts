import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../../..');

describe('Composer direct image mode', () => {
  it('MessageInput routes image-mode submits through onGenerateImage', () => {
    const src = fs.readFileSync(
      path.join(REPO_ROOT, 'src/components/chat/MessageInput.tsx'),
      'utf-8',
    );

    assert.match(src, /onGenerateImage\?: \(request: \{/);
    assert.match(src, /const \[imageMode,\s*setImageMode\]/);
    assert.match(src, /if \(imageMode\) \{/);
    assert.match(src, /await onGenerateImage\(\{[\s\S]*prompt:\s*content,[\s\S]*aspectRatio:\s*imageAspectRatio,[\s\S]*imageSize/);
    assert.match(src, /fetch\('\/api\/providers\/active-image'\)/);
    assert.match(src, /imageGen\.directModePlaceholder/);
    assert.match(src, /if \(next\) \{[\s\S]*clearBadgesWithOrder\(\);[\s\S]*setCliBadge\(null\);[\s\S]*\}/);
    assert.match(src, /\{!imageMode && \([\s\S]*<ModelSelectorDropdown/);
    assert.match(src, /\{!imageMode && showEffortSelector && \(/);
  });

  it('ChatView persists direct media generation as tool_result.media without /api/chat streaming', () => {
    const src = fs.readFileSync(
      path.join(REPO_ROOT, 'src/components/chat/ChatView.tsx'),
      'utf-8',
    );

    assert.match(src, /const handleDirectImageGeneration = useCallback/);
    assert.match(src, /fetch\('\/api\/media\/generate'/);
    assert.match(src, /fetch\('\/api\/chat\/messages'/);
    assert.match(src, /name:\s*'codepilot_generate_image'/);
    assert.match(src, /type:\s*'tool_result'/);
    assert.match(src, /media,/);
    assert.match(src, /sourceMetadata:\s*\{\s*prompt:\s*displayPrompt,\s*model:\s*result\.model/);
  });
});
