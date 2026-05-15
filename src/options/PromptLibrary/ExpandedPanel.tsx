import * as React from 'react';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  History as HistoryIcon,
  Wand2,
  Info,
  Save,
  Shuffle,
  Copy,
  Check,
  StickyNote,
} from 'lucide-react';
import type { HistoryItem, OneClickRewriteRandomness, PromptVersion } from '@/lib/types';
import { REFINE_STREAM_VERSION_ID, refineStreamDisplayedBody } from '@/lib/refineStreamVersion';
import { VersionsSidebar } from './tabs/VersionsTab';
import { MetaTab } from './tabs/MetaTab';
import { RefineInline } from './tabs/RefineInline';
import type { LibraryDockIntent } from './types';

type InlineSection = 'refine' | 'meta';

const VERSIONS_SCROLL_THRESHOLD = 6;
const VERSIONS_PANEL_W = 300;
const VERSIONS_PANEL_GAP = 12;
const VERSIONS_PANEL_MIN_LEFT = 8;

export function ExpandedPanel({
  item,
  draft,
  draftNote,
  onChangeDraft,
  onChangeNote,
  onSaveDraft,
  rewriteRandomness,
  onRewriteRandomnessChange,
  onOneClickRewrite,
  onCopy,
  copiedKey,
  onRestoreVersion,
  onDeleteVersion,
  refineInput,
  refineLoading,
  refinePartial,
  refineError,
  onChangeRefine,
  onRunRefine,
  onPickRefineSuggestion,
  initialDock = null,
  onInitialDockConsumed,
}: {
  item: HistoryItem;
  draft: string;
  draftNote: string;
  onChangeDraft: (v: string) => void;
  onChangeNote: (v: string) => void;
  onSaveDraft: () => void;
  rewriteRandomness: OneClickRewriteRandomness;
  onRewriteRandomnessChange: (level: OneClickRewriteRandomness) => void;
  onOneClickRewrite: () => void;
  onCopy: (text: string, key: string) => void;
  copiedKey: string | null;
  onRestoreVersion: (v: PromptVersion) => void;
  onDeleteVersion: (v: PromptVersion) => void;
  refineInput: string;
  refineLoading: boolean;
  /** 流式累计正文；有内容时主编辑器展示此字段以与浮动面板一致 */
  refinePartial?: string;
  refineError: string | null;
  onChangeRefine: (v: string) => void;
  onRunRefine: () => void;
  onPickRefineSuggestion: (s: string) => void;
  /** 从 Popup / options hash 出库时一次性打开对应区域 */
  initialDock?: LibraryDockIntent;
  onInitialDockConsumed?: () => void;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [sidebarLeft, setSidebarLeft] = useState<number>(VERSIONS_PANEL_MIN_LEFT);

  const [openInline, setOpenInline] = useState<InlineSection | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);

  const toggleInline = (s: InlineSection) => setOpenInline((cur) => (cur === s ? null : s));

  useLayoutEffect(() => {
    if (refineLoading) {
      setSelectedVersionId(REFINE_STREAM_VERSION_ID);
    } else {
      setSelectedVersionId((sel) =>
        sel === REFINE_STREAM_VERSION_ID ? null : sel
      );
    }
  }, [refineLoading]);

  useEffect(() => {
    if (refineLoading) setOpenInline('refine');
  }, [refineLoading]);

  /** Popup / hash deep-link：一次性打开 AI 调整或历史侧栏，并通知父组件清掉 dockIntent */
  useLayoutEffect(() => {
    if (!initialDock) return;
    if (initialDock === 'refine') {
      setOpenInline('refine');
      setVersionsOpen(false);
    } else if (initialDock === 'versions') setVersionsOpen(true);
    onInitialDockConsumed?.();
  }, [initialDock, item.id, onInitialDockConsumed]);

  const versionCount = item.versions?.length || 0;
  const versionsSidebarVisible = versionCount > 0 || refineLoading;
  const versionsDisplayCount = versionCount + (refineLoading ? 1 : 0);
  const versionsListScrollable = versionsDisplayCount >= VERSIONS_SCROLL_THRESHOLD;

  const updateSidebarLeft = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const idealLeft = r.left - VERSIONS_PANEL_W - VERSIONS_PANEL_GAP;
    let next = idealLeft;
    if (idealLeft < VERSIONS_PANEL_MIN_LEFT) {
      const rightDockLeft = r.right + VERSIONS_PANEL_GAP;
      if (rightDockLeft + VERSIONS_PANEL_W <= vw - VERSIONS_PANEL_MIN_LEFT) {
        next = rightDockLeft;
      } else {
        next = idealLeft;
      }
    }
    setSidebarLeft(next);
  }, []);

  useLayoutEffect(() => {
    if (!versionsSidebarVisible) return;
    updateSidebarLeft();
  }, [versionsSidebarVisible, updateSidebarLeft, item.id, versionsListScrollable, versionsOpen]);

  useEffect(() => {
    if (!versionsSidebarVisible) return;
    const onWin = () => updateSidebarLeft();
    window.addEventListener('scroll', onWin, true);
    window.addEventListener('resize', onWin);
    const el = anchorRef.current;
    let ro: ResizeObserver | undefined;
    if (el && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => updateSidebarLeft());
      ro.observe(el);
    }
    return () => {
      window.removeEventListener('scroll', onWin, true);
      window.removeEventListener('resize', onWin);
      ro?.disconnect();
    };
  }, [versionsSidebarVisible, updateSidebarLeft]);

  const editorValue = (() => {
    if (!refineLoading) return draft;
    const sel = selectedVersionId;
    if (sel && sel !== REFINE_STREAM_VERSION_ID) {
      const v = item.versions.find((x) => x.id === sel);
      if (v) return v.prompt;
    }
    return refineStreamDisplayedBody({
      refinePartial,
      draft,
      prompt: item.prompt,
    });
  })();

  const dirtyPrompt =
    refineLoading ? false : draft.trim() !== item.prompt.trim();
  const dirtyNote = (draftNote || '') !== (item.note || '');
  const dirty = dirtyPrompt || dirtyNote;
  const rewriteBusy = refineLoading || !(draft || item.prompt).trim();

  const handleSelectVersion = (v: PromptVersion) => {
    if (refineLoading) {
      setSelectedVersionId(v.id);
      return;
    }
    setSelectedVersionId(v.id);
    onChangeDraft(v.prompt);
  };

  const handleRestoreVersion = (v: PromptVersion) => {
    setSelectedVersionId(null);
    onRestoreVersion(v);
  };

  const handleDeleteVersion = (v: PromptVersion) => {
    if (selectedVersionId === v.id) setSelectedVersionId(null);
    onDeleteVersion(v);
  };

  return (
    <div
      ref={anchorRef}
      className="border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/30"
    >
      {versionsSidebarVisible
        ? createPortal(
            <div
              className={`fixed z-50 top-4 bottom-4 w-[300px] flex flex-col pointer-events-none overflow-visible ${
                versionsListScrollable ? '' : 'justify-center'
              }`}
              style={{ left: sidebarLeft }}
            >
              <div
                className={`flex flex-col
                  duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] transition-transform
                  motion-reduce:translate-x-0 motion-reduce:transition-none
                  ${
                    versionsListScrollable
                      ? 'h-full min-h-0 max-h-full flex-1'
                      : 'h-auto max-h-full'
                  }
                  ${versionsOpen ? 'pointer-events-auto translate-x-0 scale-100' : 'pointer-events-none translate-x-[10px] scale-100'}
                `}
                aria-hidden={!versionsOpen}
              >
                <div
                  className={`flex flex-col min-h-0 overflow-hidden rounded-2xl border border-zinc-700/70 bg-zinc-950 text-zinc-100 shadow-2xl shadow-black/40 transition-opacity duration-150 ease-out motion-reduce:duration-150 motion-reduce:ease-out ${
                    versionsListScrollable
                      ? 'flex-1 min-h-0 h-full max-h-full'
                      : 'h-auto max-h-full'
                  }`}
                  style={{ opacity: versionsOpen ? 1 : 0 }}
                >
                  <VersionsSidebar
                    item={item}
                    editorContent={editorValue}
                    selectedVersionId={selectedVersionId}
                    refineLoading={refineLoading}
                    scrollList={versionsListScrollable}
                    onSelectGeneratingRow={() =>
                      setSelectedVersionId(REFINE_STREAM_VERSION_ID)
                    }
                    onCopy={onCopy}
                    copiedKey={copiedKey}
                    onSelectVersion={handleSelectVersion}
                    onRestoreVersion={handleRestoreVersion}
                    onDeleteVersion={handleDeleteVersion}
                    onClose={() => setVersionsOpen(false)}
                  />
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {/* 主编辑区：宽度始终不变（历史侧栏经 portal 固定定位，不挤压布局） */}
      <div className="px-4 py-3 space-y-3">
        {/* 编辑器 textarea */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
              可在此修改提示词
            </span>
            <span className="text-[10px] text-zinc-400 dark:text-zinc-500 tabular-nums">
              {editorValue.length} 字
            </span>
          </div>
          <textarea
            value={editorValue}
            readOnly={refineLoading}
            onChange={(e) => {
              onChangeDraft(e.target.value);
              setSelectedVersionId(null);
            }}
            spellCheck={false}
            placeholder={
              refineLoading
                ? '正在接收 AI 调整后的提示词…'
                : '可在此修改提示词…'
            }
            className={`input-prompt min-h-[280px] max-h-[520px] resize-y w-full${
              refineLoading ? ' opacity-[0.97]' : ''
            }`}
          />
        </div>

        {/* link-button 切换区 */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 flex-wrap">
            <LinkBtn
              active={versionsOpen}
              disabled={versionCount === 0 && !refineLoading}
              onClick={() => setVersionsOpen((v) => !v)}
            >
              <HistoryIcon className="w-3.5 h-3.5" />
              <span>历史版本 · {versionsDisplayCount}</span>
            </LinkBtn>
            <LinkBtn
              active={openInline === 'refine'}
              onClick={() => toggleInline('refine')}
            >
              <Wand2 className="w-3.5 h-3.5" />
              <span>AI 调整</span>
            </LinkBtn>
            <LinkBtn
              active={openInline === 'meta'}
              onClick={() => toggleInline('meta')}
            >
              <Info className="w-3.5 h-3.5" />
              <span>详情</span>
            </LinkBtn>
          </div>
          <span
            className={`text-[11px] text-amber-600 dark:text-amber-300 inline-flex items-center gap-1 transition-opacity ${
              dirty ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
            已修改，未保存
          </span>
        </div>

        {/* AI 调整（就地展开） */}
        {openInline === 'refine' && (
          <RefineInline
            value={refineInput}
            loading={refineLoading}
            error={refineError}
            onChange={onChangeRefine}
            onSubmit={onRunRefine}
            onPick={onPickRefineSuggestion}
          />
        )}

        {/* 操作按钮行 */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <select
            value={rewriteRandomness}
            disabled={rewriteBusy}
            aria-label="一键洗稿随机强度"
            title="随机强度"
            onChange={(e) =>
              onRewriteRandomnessChange(e.target.value as OneClickRewriteRandomness)
            }
            className="text-[11px] px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 disabled:opacity-40 max-w-[76px]"
          >
            <option value="subtle">轻度</option>
            <option value="moderate">中度</option>
            <option value="bold">强烈</option>
          </select>
          <button
            type="button"
            onClick={onOneClickRewrite}
            disabled={rewriteBusy}
            className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 text-zinc-600 dark:text-zinc-300 transition"
          >
            <Shuffle className="w-3.5 h-3.5" /> 一键洗稿
          </button>
          <button
            onClick={onSaveDraft}
            disabled={!dirty}
            className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md bg-violet-500 hover:bg-violet-600 disabled:opacity-40 disabled:hover:bg-violet-500 text-white transition"
          >
            <Save className="w-3.5 h-3.5" /> 保存为新版本
          </button>
          <button
            onClick={() => onCopy(editorValue, `draft:${item.id}`)}
            className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 transition"
          >
            {copiedKey === `draft:${item.id}` ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-emerald-500">已复制</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" /> 复制
              </>
            )}
          </button>
        </div>

        {/* 备注 / 标签 */}
        <div className="flex items-center gap-2">
          <StickyNote className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500 flex-none" />
          <input
            className="input flex-1 text-[12px]"
            value={draftNote}
            onChange={(e) => onChangeNote(e.target.value)}
            placeholder="备注 / 标签（仅本地保存，可用于搜索）"
          />
        </div>

        {/* 详情（就地展开） */}
        {openInline === 'meta' && <MetaTab item={item} />}
      </div>
    </div>
  );
}

function LinkBtn({
  active,
  disabled,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] transition ${
        active
          ? 'bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300'
          : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
      } disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}
