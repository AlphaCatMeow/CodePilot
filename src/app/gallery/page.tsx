'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { SortDescending, SpinnerGap } from '@/components/ui/icon';
import { CodePilotIcon } from '@/components/ui/semantic-icon';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GalleryGrid, type GalleryItem } from '@/components/gallery/GalleryGrid';
import { GalleryDetail } from '@/components/gallery/GalleryDetail';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';

const PAGE_SIZE = 20;

type SortOrder = 'newest' | 'oldest';

export default function GalleryPage() {
  const { t } = useTranslation();

  const [items, setItems] = useState<GalleryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);

  // Filters
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sort, setSort] = useState<SortOrder>('newest');
  const [showFilters, setShowFilters] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  // Detail
  const [selectedItem, setSelectedItem] = useState<GalleryItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const fetchItems = useCallback(async (reset = false) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      if (favoritesOnly) params.set('favoritesOnly', '1');
      params.set('sort', sort);
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', reset ? '0' : String(offset));

      const res = await fetch(`/api/media/gallery?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (reset) {
          setItems(data.items || []);
          setOffset(PAGE_SIZE);
        } else {
          setItems((prev) => [...prev, ...(data.items || [])]);
          setOffset((prev) => prev + PAGE_SIZE);
        }
        setTotal(data.total || 0);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, sort, offset, favoritesOnly]);

  // Initial load and reload on filter changes
  useEffect(() => {
    setOffset(0);
    fetchItems(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, sort, favoritesOnly]);

  const handleSelect = useCallback((item: GalleryItem) => {
    setSelectedItem(item);
    setDetailOpen(true);
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/media/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setItems((prev) => prev.filter((item) => item.id !== id));
        setTotal((prev) => prev - 1);
      }
    } catch {
      // ignore
    }
  }, []);

  const handleToggleFavorite = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/media/${id}/favorite`, { method: 'PUT' });
      if (res.ok) {
        const data = await res.json();
        const favorited = !!data.favorited;
        setItems((prev) =>
          prev.map((item) =>
            item.id === id ? { ...item, favorited } : item
          )
        );
        setSelectedItem((prev) =>
          prev && prev.id === id ? { ...prev, favorited } : prev
        );
      }
    } catch {
      // ignore
    }
  }, []);

  const hasMore = items.length < total;
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingRef.current) {
          loadingRef.current = true;
          fetchItems(false).finally(() => {
            loadingRef.current = false;
          });
        }
      },
      { rootMargin: '200px' },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, fetchItems]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Page chrome — same rhythm as `/plugins`: no title/description
          (the rail label "素材库" already says where we are), no bottom
          divider. The toolbar (favorites / filters / sort) sits in the
          same row position as the plugins page's row-2 action bar. */}
      <header className="shrink-0 px-6 pt-4 pb-3">
        <div className="flex items-center justify-end gap-1.5 flex-wrap">
          <Button
            variant={favoritesOnly ? 'secondary' : 'ghost'}
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setFavoritesOnly((v) => !v)}
          >
            <CodePilotIcon
              name="favorite"
              size="sm"
              strokeWidth={favoritesOnly ? 2 : undefined}
              className={cn(favoritesOnly && 'text-status-error-foreground')}
              aria-hidden
            />
            {t('gallery.favoritesOnly' as TranslationKey)}
          </Button>
          <Button
            variant={showFilters ? 'secondary' : 'ghost'}
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setShowFilters(!showFilters)}
          >
            <CodePilotIcon name="filter" size="sm" aria-hidden />
            {t('gallery.filters' as TranslationKey)}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setSort((s) => (s === 'newest' ? 'oldest' : 'newest'))}
          >
            <SortDescending size={14} />
            {sort === 'newest'
              ? t('gallery.newestFirst' as TranslationKey)
              : t('gallery.oldestFirst' as TranslationKey)}
          </Button>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 pb-5">
        {/* Filter bar */}
        {showFilters && (
          <div className="mb-4 space-y-2.5">
            {/* Date range */}
            <div className="flex items-center gap-2">
              <Label htmlFor="gallery-date-from" className="text-xs text-muted-foreground">
                {t('gallery.dateFrom' as TranslationKey)}
              </Label>
              <Input
                id="gallery-date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-7 w-auto px-2 text-xs"
              />
              <Label htmlFor="gallery-date-to" className="text-xs text-muted-foreground">
                {t('gallery.dateTo' as TranslationKey)}
              </Label>
              <Input
                id="gallery-date-to"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-7 w-auto px-2 text-xs"
              />
              {(dateFrom || dateTo) && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    setDateFrom('');
                    setDateTo('');
                  }}
                >
                  {t('gallery.clearFilters' as TranslationKey)}
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Gallery content */}
        {loading && items.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <CodePilotIcon name="appearance" size={40} className="opacity-30" aria-hidden />
            <p className="text-sm">{t('gallery.empty' as TranslationKey)}</p>
            <p className="text-xs opacity-70">{t('gallery.emptyHint' as TranslationKey)}</p>
          </div>
        ) : (
          <div>
            <GalleryGrid
              items={items}
              onSelect={handleSelect}
            />
            {/* Sentinel for infinite scroll */}
            <div ref={sentinelRef} className="flex justify-center py-4">
              {loading && (
                <SpinnerGap size={16} className="animate-spin text-muted-foreground" />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Detail dialog */}
      <GalleryDetail
        item={selectedItem}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onDelete={handleDelete}
        onToggleFavorite={handleToggleFavorite}
      />
    </div>
  );
}
