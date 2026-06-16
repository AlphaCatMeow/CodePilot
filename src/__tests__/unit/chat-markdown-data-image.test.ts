import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

import { chatRehypePlugins } from '../../lib/markdown/chat-rehype-plugins';

type SimpleNode = {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: SimpleNode[];
};

function renderChatMarkdown(markdown: string): SimpleNode {
  const processor = unified()
    .use(remarkParse)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(chatRehypePlugins);

  return processor.runSync(processor.parse(markdown)) as SimpleNode;
}

function findFirst(node: SimpleNode, tagName: string): SimpleNode | undefined {
  if (node.tagName === tagName) return node;
  for (const child of node.children ?? []) {
    const found = findFirst(child, tagName);
    if (found) return found;
  }
  return undefined;
}

function textContent(node: SimpleNode): string {
  return [
    node.value ?? '',
    ...(node.children ?? []).map(textContent),
  ].join('');
}

describe('chat markdown data image hardening', () => {
  it('keeps raster base64 data images renderable in assistant markdown', () => {
    const tree = renderChatMarkdown('![generated](data:image/png;base64,AAAA)');
    const img = findFirst(tree, 'img');

    assert.equal(img?.properties?.src, 'data:image/png;base64,AAAA');
    assert.equal(img?.properties?.alt, 'generated');
    assert.equal(textContent(tree).includes('[Image blocked'), false);
  });

  it('still blocks non-raster or non-base64 data images', () => {
    const svgTree = renderChatMarkdown('![svg](data:image/svg+xml;base64,AAAA)');
    const textTree = renderChatMarkdown('![html](data:text/html;base64,AAAA)');
    const plainTree = renderChatMarkdown('![plain](data:image/png,AAAA)');

    assert.match(textContent(svgTree), /\[Image blocked: svg\]/);
    assert.match(textContent(textTree), /\[Image blocked: html\]/);
    assert.match(textContent(plainTree), /\[Image blocked: plain\]/);
  });

  it('keeps dangerous links blocked after enabling data image src', () => {
    const tree = renderChatMarkdown('[bad](javascript:alert(1))');

    assert.equal(findFirst(tree, 'a'), undefined);
    assert.match(textContent(tree), /bad \[blocked\]/);
  });
});
