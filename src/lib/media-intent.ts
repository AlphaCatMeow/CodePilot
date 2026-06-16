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
