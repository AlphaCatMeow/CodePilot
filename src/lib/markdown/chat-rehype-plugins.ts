import type { StreamdownProps } from 'streamdown';
import { defaultRehypePlugins } from 'streamdown';
import type { PluggableList, Plugin } from 'unified';

type HastNode = {
  type?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

const RASTER_BASE64_DATA_IMAGE_RE =
  /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

const chatSanitizeSchema = {
  protocols: {
    cite: ['http', 'https'],
    href: ['http', 'https', 'irc', 'ircs', 'mailto', 'xmpp'],
    longDesc: ['http', 'https'],
    src: ['http', 'https', 'data'],
  },
};

function restrictChatDataImages() {
  return function transform(tree: HastNode) {
    function visit(node: HastNode) {
      if (
        node.type === 'element' &&
        node.tagName === 'img' &&
        node.properties &&
        typeof node.properties.src === 'string'
      ) {
        const src = node.properties.src;
        if (src.startsWith('data:') && !RASTER_BASE64_DATA_IMAGE_RE.test(src)) {
          delete node.properties.src;
        }
      }

      for (const child of node.children ?? []) {
        visit(child);
      }
    }

    visit(tree);
  };
}

const sanitizePlugin = (
  Array.isArray(defaultRehypePlugins.sanitize)
    ? defaultRehypePlugins.sanitize[0]
    : defaultRehypePlugins.sanitize
) as Plugin;

export const chatRehypePlugins: NonNullable<StreamdownProps['rehypePlugins']> & PluggableList = [
  defaultRehypePlugins.raw,
  [sanitizePlugin, chatSanitizeSchema],
  restrictChatDataImages,
  defaultRehypePlugins.harden,
];
