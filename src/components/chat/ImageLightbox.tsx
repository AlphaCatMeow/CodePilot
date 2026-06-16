'use client';

import { useState, useCallback, useEffect } from 'react';
import { CodePilotIcon } from "@/components/ui/semantic-icon";
import { Button } from "@/components/ui/button";
import { showToast } from '@/hooks/useToast';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';

export interface LightboxImage {
  src: string;
  alt: string;
  assetId?: string;
  data?: string;
  mimeType?: string;
  localPath?: string;
  mediaId?: string;
  sessionId?: string;
  messageId?: string;
  prompt?: string;
  model?: string;
  filename?: string;
}

interface ImageLightboxProps {
  images: LightboxImage[];
  initialIndex: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImageLightbox({ images, initialIndex, open, onOpenChange }: ImageLightboxProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [resolvedMediaIds, setResolvedMediaIds] = useState<Record<number, string>>({});
  const [resolvedAssets, setResolvedAssets] = useState<Record<number, { assetId: string; contentUrl: string; mediaId: string | null }>>({});
  const [favoritedMediaIds, setFavoritedMediaIds] = useState<Record<string, boolean>>({});
  const [busyAction, setBusyAction] = useState<'download' | 'library' | 'favorite' | null>(null);

  useEffect(() => {
    if (open) setCurrentIndex(initialIndex);
  }, [initialIndex, open]);

  const goToPrev = useCallback(() => {
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1));
  }, [images.length]);

  const goToNext = useCallback(() => {
    setCurrentIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0));
  }, [images.length]);

  // Reset index when dialog opens with a new initialIndex
  const handleOpenChange = useCallback((newOpen: boolean) => {
    if (newOpen) {
      setCurrentIndex(initialIndex);
    }
    onOpenChange(newOpen);
  }, [initialIndex, onOpenChange]);

  const currentSessionId = useCallback((image: LightboxImage): string | undefined => {
    if (image.sessionId) return image.sessionId;
    if (typeof window === 'undefined') return undefined;
    const match = window.location.pathname.match(/\/chat\/([^/?#]+)/);
    return match?.[1];
  }, []);

  const ensureAsset = useCallback(async (index: number): Promise<{ assetId: string; contentUrl: string; mediaId: string | null } | null> => {
    const image = images[index];
    if (!image) return null;
    const existing = resolvedAssets[index];
    if (existing) return existing;
    if (image.assetId) {
      const asset = {
        assetId: image.assetId,
        contentUrl: `/api/chat/media-assets/${encodeURIComponent(image.assetId)}/content`,
        mediaId: image.mediaId || resolvedMediaIds[index] || null,
      };
      setResolvedAssets((prev) => ({ ...prev, [index]: asset }));
      return asset;
    }
    const sessionId = currentSessionId(image);
    if (!sessionId || !image.data || !image.mimeType) {
      return null;
    }

    const response = await fetch('/api/chat/media-assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        messageId: image.messageId,
        mimeType: image.mimeType,
        data: image.data,
        prompt: image.prompt || image.alt,
        model: image.model,
        source: 'markdown-data-url',
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.assetId || !payload.contentUrl) {
      throw new Error(payload.error || '图片缓存失败');
    }
    const asset = {
      assetId: payload.assetId as string,
      contentUrl: payload.contentUrl as string,
      mediaId: (payload.mediaId as string | null) || null,
    };
    setResolvedAssets((prev) => ({ ...prev, [index]: asset }));
    if (asset.mediaId) {
      setResolvedMediaIds((prev) => ({ ...prev, [index]: asset.mediaId! }));
      if (payload.favorited) {
        setFavoritedMediaIds((prev) => ({ ...prev, [asset.mediaId!]: true }));
      }
    }
    return asset;
  }, [currentSessionId, images, resolvedAssets, resolvedMediaIds]);

  const handleDownload = useCallback(async () => {
    const current = images[currentIndex];
    if (!current) return;
    setBusyAction('download');
    try {
      const asset = current.src.startsWith('data:') ? await ensureAsset(currentIndex) : null;
      const src = asset?.contentUrl || current.src;
      const response = await fetch(src);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const extension = (current.mimeType?.split('/')[1] || 'png').replace('jpeg', 'jpg');
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = current.filename || `codepilot-image-${Date.now()}.${extension}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(current.src, '_blank');
    } finally {
      setBusyAction(null);
    }
  }, [currentIndex, ensureAsset, images]);

  const ensureMediaId = useCallback(async (index: number): Promise<string | null> => {
    const image = images[index];
    if (!image) return null;
    const existing = image.mediaId || resolvedMediaIds[index];
    if (existing) return existing;
    const asset = await ensureAsset(index);
    if (!asset) {
      showToast({ type: 'error', message: '这张图片没有可添加到素材库的数据' });
      return null;
    }

    if (asset.mediaId) return asset.mediaId;

    const response = await fetch(`/api/chat/media-assets/${encodeURIComponent(asset.assetId)}/promote`, { method: 'POST' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.mediaId) {
      throw new Error(payload.error || '添加到素材库失败');
    }
    setResolvedMediaIds((prev) => ({ ...prev, [index]: payload.mediaId }));
    if (payload.favorited) {
      setFavoritedMediaIds((prev) => ({ ...prev, [payload.mediaId as string]: true }));
    }
    setResolvedAssets((prev) => ({
      ...prev,
      [index]: {
        assetId: asset.assetId,
        contentUrl: asset.contentUrl,
        mediaId: payload.mediaId as string,
      },
    }));
    return payload.mediaId as string;
  }, [ensureAsset, images, resolvedMediaIds]);

  const handleAddToLibrary = useCallback(async () => {
    setBusyAction('library');
    try {
      const mediaId = await ensureMediaId(currentIndex);
      if (!mediaId) return;
      showToast({ type: 'success', message: '已添加到素材库' });
    } catch (err) {
      showToast({ type: 'error', message: err instanceof Error ? err.message : '添加到素材库失败' });
    } finally {
      setBusyAction(null);
    }
  }, [currentIndex, ensureMediaId]);

  const handleFavorite = useCallback(async () => {
    const mediaId = images[currentIndex]?.mediaId || resolvedMediaIds[currentIndex];
    if (!mediaId) {
      showToast({ type: 'error', message: '请先添加到素材库' });
      return;
    }
    setBusyAction('favorite');
    try {
      const response = await fetch(`/api/media/${encodeURIComponent(mediaId)}/favorite`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ favorited: true }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '收藏失败');
      }
      setFavoritedMediaIds((prev) => ({ ...prev, [mediaId]: !!payload.favorited }));
      showToast({ type: 'success', message: payload.favorited ? '已收藏' : '已取消收藏' });
    } catch (err) {
      showToast({ type: 'error', message: err instanceof Error ? err.message : '收藏失败' });
    } finally {
      setBusyAction(null);
    }
  }, [currentIndex, images, resolvedMediaIds]);

  if (images.length === 0) return null;

  const current = images[currentIndex];
  const sessionId = currentSessionId(current);
  const currentMediaId = current.mediaId || resolvedMediaIds[currentIndex];
  const isInLibrary = Boolean(currentMediaId);
  const isFavorited = Boolean(currentMediaId && favoritedMediaIds[currentMediaId]);
  const canAddToLibrary = Boolean(
    !isInLibrary && (
      current.assetId ||
      (sessionId && current.mimeType && current.data)
    )
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-[95vw] max-h-[95vh] p-0 border-none bg-black/90 shadow-none sm:max-w-[95vw]"
        showCloseButton
      >
        <DialogTitle className="sr-only">Image preview</DialogTitle>
        <div
          className="relative flex items-center justify-center min-h-[50vh]"
          onClick={() => onOpenChange(false)}
        >
          <div
            className="absolute left-3 top-3 z-10 flex items-center gap-1"
            onClick={(event) => event.stopPropagation()}
          >
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleDownload}
              disabled={busyAction !== null}
              className="rounded-full bg-black/50 text-white hover:bg-black/70 hover:text-white"
              title="保存到本地"
            >
              <CodePilotIcon name="download" size="sm" aria-hidden className="text-inherit" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleAddToLibrary}
              disabled={isInLibrary || !canAddToLibrary || busyAction !== null}
              className="rounded-full bg-black/50 text-white hover:bg-black/70 hover:text-white disabled:opacity-40"
              title={isInLibrary ? '已添加到素材库' : '添加到素材库'}
            >
              <CodePilotIcon name="archive" size="sm" aria-hidden className="text-inherit" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleFavorite}
              disabled={!isInLibrary || busyAction !== null}
              className="rounded-full bg-black/50 text-white hover:bg-black/70 hover:text-white disabled:opacity-40"
              title={isFavorited ? '已收藏' : '收藏'}
            >
              <CodePilotIcon name="favorite" size="sm" aria-hidden className="text-inherit" />
            </Button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={current.src}
            alt={current.alt}
            className="max-w-[90vw] max-h-[90vh] object-contain"
            onClick={(event) => event.stopPropagation()}
          />

          {images.length > 1 && (
            <>
              <Button
                variant="ghost"
                size="icon"
                onClick={(event) => {
                  event.stopPropagation();
                  goToPrev();
                }}
                className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70 transition"
              >
                <CodePilotIcon name="back" size={24} aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={(event) => {
                  event.stopPropagation();
                  goToNext();
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70 transition"
              >
                <CodePilotIcon name="forward" size={24} aria-hidden />
              </Button>
              <div
                className="absolute bottom-3 left-1/2 -translate-x-1/2 text-white/70 text-sm"
                onClick={(event) => event.stopPropagation()}
              >
                {currentIndex + 1} / {images.length}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
