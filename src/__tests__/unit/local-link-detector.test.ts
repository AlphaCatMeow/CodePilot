/**
 * Phase 4 P2.1 — markdown link interception classifier.
 *
 * The chat renders `[label](path)` as an <a href="path">; without
 * interception the browser tries to navigate to path against
 * `localhost:3000` and 404s. These helpers say whether the click
 * should be intercepted (local file) or left alone (remote URL).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  looksLikeRemoteHref,
  isPotentialLocalFile,
} from '../../lib/markdown/local-link-detector';

describe('looksLikeRemoteHref', () => {
  it('flags hrefs with explicit schemes as remote', () => {
    for (const href of [
      'http://example.com',
      'https://example.com',
      'mailto:a@b',
      'tel:+1234',
      'javascript:void(0)',
      'data:text/plain,hi',
      'blob:http://x/abc',
      'ftp://x/y',
    ]) {
      assert.equal(looksLikeRemoteHref(href), true, href);
    }
  });

  it('flags protocol-relative and fragment-only as remote / non-local', () => {
    assert.equal(looksLikeRemoteHref('//cdn.example.com/a.css'), true);
    assert.equal(looksLikeRemoteHref('#heading-slug'), true);
  });

  it('treats local paths as non-remote', () => {
    assert.equal(looksLikeRemoteHref('/abs/foo.md'), false);
    assert.equal(looksLikeRemoteHref('docs/foo.md'), false);
    assert.equal(looksLikeRemoteHref('README.md'), false);
  });
});

describe('isPotentialLocalFile', () => {
  it('accepts absolute POSIX + Windows paths', () => {
    assert.equal(isPotentialLocalFile('/abs/foo.txt'), true);
    assert.equal(isPotentialLocalFile('/abs/foo'), true); // abs without ext
    assert.equal(isPotentialLocalFile('C:\\abs\\foo.txt'), true);
    assert.equal(isPotentialLocalFile('C:/abs/foo.txt'), true);
  });

  it('accepts relative paths with previewable extensions', () => {
    for (const path of ['README.md', 'docs/x.html', 'a/b/c.json', 'data.csv']) {
      assert.equal(isPotentialLocalFile(path), true, path);
    }
  });

  it('rejects relative paths with non-previewable extensions', () => {
    for (const path of ['foo.bar', 'archive.zip', 'binary.exe', 'something.unknownext']) {
      assert.equal(isPotentialLocalFile(path), false, path);
    }
  });

  it('strips a trailing anchor (`#L12` / `:12`) before extension check', () => {
    assert.equal(isPotentialLocalFile('README.md#L12'), true);
    assert.equal(isPotentialLocalFile('docs/x.json:42'), true);
  });

  it('rejects empty / pathless input', () => {
    assert.equal(isPotentialLocalFile(''), false);
    assert.equal(isPotentialLocalFile('no-extension-bare-word'), false);
  });
});

// Phase 4 P1.1 — workingDirectory-relative resolution before classify.
// The chip click handler in DevOutputChips uses `resolveToolPath` to
// turn a bare / relative file ref into an absolute path BEFORE
// `classifyPath` decides workspace vs. agent-referenced. This test
// pins the contract that a workspace-relative path lands as
// `workspace` (not as `agent-referenced` followed by a homeDir
// fetch).
describe('relative-path resolution → classifyPath workspace tier', () => {
  // Import via require to keep this test in the same file without
  // adding a new top-level dependency.
  it('bare filename + workingDirectory → resolves under workspace + classifies workspace', async () => {
    const { resolveToolPath } = await import('../../lib/file-write-tools');
    const { classifyPath } = await import('../../lib/preview-source');
    const cwd = '/Users/me/proj';
    const absolute = resolveToolPath('README.md', cwd);
    assert.equal(absolute, '/Users/me/proj/README.md');
    const cls = classifyPath(absolute, cwd);
    assert.equal(cls.trust, 'workspace');
    assert.equal(cls.baseDir, cwd);
  });

  it('relative subdir + workingDirectory → workspace tier', async () => {
    const { resolveToolPath } = await import('../../lib/file-write-tools');
    const { classifyPath } = await import('../../lib/preview-source');
    const cwd = '/Users/me/proj';
    const absolute = resolveToolPath('src/foo.ts', cwd);
    assert.equal(absolute, '/Users/me/proj/src/foo.ts');
    const cls = classifyPath(absolute, cwd);
    assert.equal(cls.trust, 'workspace');
  });

  it('without workingDirectory: classify falls through to agent-referenced (confirm flow)', async () => {
    const { resolveToolPath } = await import('../../lib/file-write-tools');
    const { classifyPath } = await import('../../lib/preview-source');
    // resolveToolPath returns the raw path unchanged when cwd is missing.
    const absolute = resolveToolPath('README.md', null);
    assert.equal(absolute, 'README.md');
    // classifyPath without cwd → agent-referenced (the safe default).
    const cls = classifyPath(absolute, null);
    assert.equal(cls.trust, 'agent-referenced');
  });

  it('absolute paths pass through unchanged', async () => {
    const { resolveToolPath } = await import('../../lib/file-write-tools');
    assert.equal(resolveToolPath('/abs/foo.md', '/Users/me/proj'), '/abs/foo.md');
  });
});
