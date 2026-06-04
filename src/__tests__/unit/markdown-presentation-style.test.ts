/**
 * Phase 4 UX I — Markdown in-place presentation style.
 *
 * Pins:
 *  - 5 styles in the user-facing Select (Default / Article / Report
 *    / Brief / Pitch)
 *  - Default style ID = 'article' (Markdown opens looking polished)
 *  - PreviewSource.file accepts a presentationTemplate field
 *  - tabFromPreviewSource carries presentationTemplate through to the
 *    workspace-sidebar Tab so it survives reload + tab dedup
 *  - previewSourceFromTab restores the style on parse
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MARKDOWN_PRESENTATION_STYLES,
  DEFAULT_MARKDOWN_PRESENTATION_STYLE,
} from '../../lib/markdown/presentation-templates';
import {
  tabFromPreviewSource,
  previewSourceFromTab,
  serialize,
  parse,
  openDynamicTab,
  initialState,
} from '../../lib/workspace-sidebar';

describe('MARKDOWN_PRESENTATION_STYLES contract', () => {
  it('exposes exactly the five styles the user spec calls for', () => {
    const ids = MARKDOWN_PRESENTATION_STYLES.map((s) => s.id);
    assert.deepEqual(
      ids,
      ['default', 'article', 'report', 'brief', 'pitch'],
    );
  });

  it('default style id is "article" (polished on first open)', () => {
    assert.equal(DEFAULT_MARKDOWN_PRESENTATION_STYLE, 'article');
  });

  it('every style has a non-empty label', () => {
    for (const s of MARKDOWN_PRESENTATION_STYLES) {
      assert.ok(s.label && s.label.length > 0, `style ${s.id} label`);
    }
  });
});

describe('PreviewSource.file presentationTemplate', () => {
  it('tabFromPreviewSource carries presentationTemplate through', () => {
    const tab = tabFromPreviewSource({
      kind: 'file',
      filePath: '/proj/notes.md',
      trust: 'workspace',
      baseDir: '/proj',
      presentationTemplate: 'report',
    });
    if (tab.kind !== 'markdown') {
      assert.fail('expected markdown tab for .md');
      return;
    }
    assert.equal(tab.presentationTemplate, 'report');
  });

  it('previewSourceFromTab restores presentationTemplate on a markdown tab', () => {
    const src = previewSourceFromTab({
      id: 'markdown:/proj/x.md',
      kind: 'markdown',
      key: '/proj/x.md',
      title: 'x.md',
      filePath: '/proj/x.md',
      presentationTemplate: 'pitch',
    });
    if (src?.kind !== 'file') {
      assert.fail('expected file source');
      return;
    }
    assert.equal(src.presentationTemplate, 'pitch');
  });

  it('back-compat: a markdown tab without presentationTemplate restores cleanly', () => {
    // Existing persisted tabs from before this UX batch lack the
    // field. The reader must NOT inject undefined; consumers fall
    // back to DEFAULT_MARKDOWN_PRESENTATION_STYLE at the render
    // boundary.
    const src = previewSourceFromTab({
      id: 'markdown:/proj/x.md',
      kind: 'markdown',
      key: '/proj/x.md',
      title: 'x.md',
      filePath: '/proj/x.md',
    });
    assert.deepEqual(src, { kind: 'file', filePath: '/proj/x.md' });
  });

  it('serialize → parse round-trip preserves presentationTemplate', () => {
    let s = initialState({ open: true });
    s = openDynamicTab(
      s,
      tabFromPreviewSource({
        kind: 'file',
        filePath: '/proj/note.md',
        trust: 'workspace',
        baseDir: '/proj',
        presentationTemplate: 'brief',
      }),
    );
    const wire = JSON.stringify(serialize(s));
    const restored = parse(wire);
    const tab = restored.tabs.find((t) => t.kind === 'markdown');
    assert.ok(tab && tab.kind === 'markdown');
    if (!tab || tab.kind !== 'markdown') return;
    assert.equal(tab.presentationTemplate, 'brief');
  });
});
