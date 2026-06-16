const MEDIA_KEYWORDS =
  /生成\s*(?:一[张幅个])?.{0,16}(?:图|图片|图像|海报|插画|封面|头像)|画\s*(?:一[张幅个])?.{0,16}(?:图|图片|图像|海报|插画|封面|头像)|(?:文生图|生图|出图|作图|画图|绘图|图片|图像|海报图|海报|素材)|(?:generate|create|draw|make)\s+(?:an?\s+)?(?:image|picture|poster|illustration|cover)|(?:image|picture|poster|illustration|cover)\s+(?:generation|generate)|import.*library|save.*library|codepilot_import_media|codepilot_generate_image/i;

export function promptNeedsMedia(
  prompt?: string,
  conversationHistory?: ReadonlyArray<{ content: string }>,
): boolean {
  if (prompt && MEDIA_KEYWORDS.test(prompt)) return true;
  if (conversationHistory?.some((m) => MEDIA_KEYWORDS.test(m.content))) return true;
  return false;
}

export interface DirectImageGenerationRequest {
  prompt: string;
  aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
  imageSize?: '1K' | '2K';
}

const ASPECT_RATIOS = new Set(['1:1', '16:9', '9:16', '4:3', '3:4']);
const ASPECT_RATIO_PATTERN = '(1:1|16:9|9:16|4:3|3:4)';

export function parseDirectImageGenerationRequest(
  content?: string,
): DirectImageGenerationRequest | null {
  if (!content || !/\bcodepilot_generate_image\b/i.test(content)) return null;

  const aspectRatioMatch = content.match(new RegExp(`(?:比例|aspect\\s*ratio)\\s*[:：]?\\s*${ASPECT_RATIO_PATTERN}`, 'i'))
    ?? content.match(new RegExp(`\\b${ASPECT_RATIO_PATTERN}\\b`, 'i'));
  const aspectRatio = aspectRatioMatch && ASPECT_RATIOS.has(aspectRatioMatch[1])
    ? aspectRatioMatch[1] as DirectImageGenerationRequest['aspectRatio']
    : undefined;

  const imageSizeMatch = content.match(/\b(1K|2K)\b/i);
  const imageSize = imageSizeMatch
    ? imageSizeMatch[1].toUpperCase() as DirectImageGenerationRequest['imageSize']
    : undefined;

  const promptMatch = content.match(/(?:提示词|prompt)\s*[:：]\s*([\s\S]+)/i);
  const rawPrompt = (promptMatch?.[1] ?? content)
    .replace(/\bcodepilot_generate_image\b/ig, '')
    .replace(/请\s*直接\s*调用/g, '')
    .replace(/工具/g, '')
    .replace(/生成图片/g, '')
    .replace(/生成图像/g, '')
    .replace(/提示词\s*[:：]/g, '')
    .replace(new RegExp(`(?:比例|aspect\\s*ratio)\\s*[:：]?\\s*${ASPECT_RATIO_PATTERN}`, 'ig'), '')
    .replace(new RegExp(`\\b${ASPECT_RATIO_PATTERN}\\b(?=\\s*(?:海报|poster|图片|image|图|$))`, 'ig'), '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([。！？,.，；;])/g, '$1')
    .trim();

  if (!rawPrompt) return null;
  return { prompt: rawPrompt, aspectRatio, imageSize };
}
