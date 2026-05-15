import { useCallback, useRef, useState } from 'react';
import type { HistoryItem } from '@/lib/types';
import { getHistoryItem } from '@/lib/storage';

/**
 * Popup 历史列表里「展开某条的内联版本」：用 generation 忽略过期的 getHistoryItem 回调。
 */
export function usePopupVersionsDetail(reloadList: () => void | Promise<void>) {
  const [versionsExpandedId, setVersionsExpandedId] = useState<string | null>(null);
  const [versionsDetailItem, setVersionsDetailItem] = useState<HistoryItem | null>(null);
  const [versionsDetailLoading, setVersionsDetailLoading] = useState(false);
  const versionsFetchGenRef = useRef(0);
  const versionsExpandedIdRef = useRef<string | null>(null);
  versionsExpandedIdRef.current = versionsExpandedId;

  const toggleVersionsPanel = useCallback(
    (item: HistoryItem) => {
      if (versionsExpandedId === item.id) {
        versionsFetchGenRef.current += 1;
        setVersionsExpandedId(null);
        setVersionsDetailItem(null);
        setVersionsDetailLoading(false);
        return;
      }
      versionsFetchGenRef.current += 1;
      const gen = versionsFetchGenRef.current;
      setVersionsExpandedId(item.id);
      setVersionsDetailItem(null);
      setVersionsDetailLoading(true);
      void getHistoryItem(item.id).then((fresh) => {
        if (gen !== versionsFetchGenRef.current) return;
        setVersionsDetailLoading(false);
        if (!fresh) {
          setVersionsExpandedId(null);
          void reloadList();
          return;
        }
        setVersionsDetailItem(fresh);
      });
    },
    [versionsExpandedId, reloadList]
  );

  const refreshVersionsDetailAfterMutation = useCallback(async () => {
    await reloadList();
    const id = versionsExpandedIdRef.current;
    if (!id) return;
    const fresh = await getHistoryItem(id);
    if (!fresh) {
      versionsFetchGenRef.current += 1;
      setVersionsExpandedId(null);
      setVersionsDetailItem(null);
      await reloadList();
      return;
    }
    setVersionsDetailItem(fresh);
  }, [reloadList]);

  const collapseVersionsForItem = useCallback((itemId: string) => {
    if (versionsExpandedId !== itemId) return;
    versionsFetchGenRef.current += 1;
    setVersionsExpandedId(null);
    setVersionsDetailItem(null);
    setVersionsDetailLoading(false);
  }, [versionsExpandedId]);

  return {
    versionsExpandedId,
    versionsDetailItem,
    versionsDetailLoading,
    toggleVersionsPanel,
    refreshVersionsDetailAfterMutation,
    collapseVersionsForItem,
  };
}
