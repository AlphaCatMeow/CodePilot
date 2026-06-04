'use client';

import { CodePilotIcon } from '@/components/ui/semantic-icon';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';

export interface GalleryItem {
  id: string;
  /** Generation provider (e.g. 'gemini', 'codex', 'cli-import'). Used by
   *  the UI to label the engine that produced the image. */
  provider?: string;
  prompt: string;
  images: Array<{ data?: string; mimeType: string; localPath?: string }>;
  type?: 'image' | 'video' | 'audio';
  model?: string;
  aspectRatio?: string;
  imageSize?: string;
  tags: string[];
  favorited?: boolean;
  created_at: string;
  session_id?: string;
  referenceImages?: Array<{ mimeType: string; localPath: string }>;
}

interface GalleryGridProps {
  items: GalleryItem[];
  onSelect: (item: GalleryItem) => void;
}

function thumbnailUrl(item: GalleryItem): string {
  const img = item.images[0];
  if (!img) return '';
  if (img.localPath) {
    return `/api/media/serve?path=${encodeURIComponent(img.localPath)}`;
  }
  if (img.data) {
    return `data:${img.mimeType};base64,${img.data}`;
  }
  return '';
}

function isVideoItem(item: GalleryItem): boolean {
  if (item.type === 'video') return true;
  const img = item.images[0];
  return !!img?.mimeType?.startsWith('video/');
}

export function GalleryGrid({ items, onSelect }: GalleryGridProps) {
  const { t } = useTranslation();
  return (
    <div
      className="gap-3"
      style={{
        columnCount: 6,
        columnGap: '12px',
      }}
    >
      {items.map((item) => {
        const url = thumbnailUrl(item);
        const isVideo = isVideoItem(item);
        const promptPreview = item.prompt.length > 80
          ? `${item.prompt.slice(0, 80)}…`
          : item.prompt;
        const ariaKey: TranslationKey = isVideo
          ? 'gallery.playVideoAria'
          : 'gallery.openItemAria';

        return (
          // role="button" + tabIndex + Enter/Space handler — image
          // tiles are the primary activator on this page; without
          // these the a11y tree only exposes them as "image" and
          // keyboard / screen-reader users have no way in.
          <div
            key={item.id}
            role="button"
            tabIndex={0}
            aria-label={t(ariaKey, { prompt: promptPreview })}
            className="mb-3 cursor-pointer rounded-lg overflow-hidden ring-0 hover:ring-2 hover:ring-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all"
            style={{ breakInside: 'avoid' }}
            onClick={() => onSelect(item)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(item);
              }
            }}
          >
            <div className="relative bg-muted/30">
              {url ? (
                isVideo ? (
                   
                  <video
                    src={url}
                    muted
                    preload="metadata"
                    className="block w-full h-auto"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={url}
                    alt={item.prompt}
                    className="block w-full h-auto"
                    loading="lazy"
                  />
                )
              ) : (
                <div className="flex aspect-square items-center justify-center">
                  <CodePilotIcon name="appearance" size="xl" className="text-muted-foreground/30" aria-hidden />
                </div>
              )}
              {isVideo && url && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm">
                    <CodePilotIcon name="play" size="lg" strokeWidth={2} className="text-white ml-0.5" aria-hidden />
                  </span>
                </span>
              )}
              {item.images.length > 1 && (
                <span className="absolute top-1.5 right-1.5 rounded-full bg-black/50 px-1.5 py-0.5 text-[10px] text-white font-medium">
                  {item.images.length}
                </span>
              )}
              {item.favorited && (
                <span className="absolute top-1.5 left-1.5">
                  <CodePilotIcon name="favorite" size="md" strokeWidth={2} className="text-status-error-foreground drop-shadow" aria-hidden />
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
