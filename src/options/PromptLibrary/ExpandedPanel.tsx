import * as React from 'react';
import { useEffect, useState } from 'react';
import {
  History as HistoryIcon,
  Wand2,
  Info,
  Save,
  RotateCcw,
  Copy,
  Check,
  StickyNote,
} from 'lucide-react';
import type { HistoryItem, PromptVersion } from '@/lib/types';
import { VersionsSidebar } from './tabs/VersionsTab';
import { MetaTab } from './tabs/MetaTab';
import { RefineInline } from './tabs/RefineInline';

type InlineSection = 'refine' | 'meta';

export function ExpandedPanel({
  item,
  draft,
  draftNote,
  onChangeDraft,
  onChangeNote,
  onSaveDraft,
  onResetDraft,
  onCopy,
  copiedKey,
  onRestoreVersion,
  onDeleteVersion,
  refineInput,
  refineLoading,
  refineError,
  onChangeRefine,
  onRunRefine,
  onPickRefineSuggestion,
}: {
  item: HistoryItem;
  draft: string;
  draftNote: string;
  onChangeDraft: (v: string) => void;
  onChangeNote: (v: string) => void;
  onSaveDraft: () => void;
  onResetDraft: () => void;
  onCopy: (text: string, key: string) => void;
  copiedKey: string | null;
  onRestoreVersion: (v: PromptVersion) => void;
  onDeleteVersion: (v: PromptVersion) => void;
  refineInput: string;
  refineLoading: boolean;
  refineError: string | null;
  onChangeRefine: (v: string) => void;
  onRunRefine: () => void;
  onPickRefineSuggestion: (s: string) => void;
}) {
  const [openInline, setOpenInline] = useState<InlineSection | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);

  const toggleInline = (s: InlineSection) => setOpenInline((cur) => (cur === s ? null : s));

  useEffect(() => {
    if (refineLoading) setOpenInline('refine');
  }, [refineLoading]);

  const dirtyPrompt = draft.trim() !== item.prompt.trim();
  const dirtyNote = (draftNote || '') !== (item.note || '');
  const dirty = dirtyPrompt || dirtyNote;
  const versionCount = item.versions?.length || 0;

  const handleSelectVersion = (v: PromptVersion) => {
    setSelectedVersionId(v.id);
    onChangeDraft(v.prompt);
  };

  return (
    <div className="border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/30 relative">
      {/* 版本侧边栏：浮层覆盖，不影响编辑区宽度 */}
      <div
        className="absolute left-0 top-0 bottom-0 z-10 overflow-hidden border-r border-zinc-200 dark:border-zinc-700 transition-all duration-300 ease-[cubic-bezier(.2,.9,.3,1.2)]"
        style={{
          width: versionsOpen && versionCount > 0 ? 300 : 0,
          opacity: versionsOpen && versionCount > 0 ? 1 : 0,
          pointerEvents: versionsOpen && versionCount > 0 ? 'auto' : 'none',
          borderRightColor: versionsOpen && versionCount > 0 ? undefined : 'transparent',
        }}
      >
        <div className="h-full" style={{ minWidth: 300 }}>
          <VersionsSidebar
            item={item}
            editorContent={draft}
            selectedVersionId={selectedVersionId}
            onCopy={onCopy}
            copiedKey={copiedKey}
            onSelectVersion={handleSelectVersion}
            onRestoreVersion={onRestoreVersion}
            onDeleteVersion={onDeleteVersion}
            onClose={() => setVersionsOpen(false)}
          />
        </div>
      </div>

      {/* 主编辑区：宽度始终不变 */}
      <div className="px-4 py-3 space-y-3">
        {/* 编辑器 textarea */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
              可在此修改提示词
            </span>
            <span className="text-[10px] text-zinc-400 dark:text-zinc-500 tabular-nums">
              {draft.length} 字
            </span>
          </div>
          <textarea
            value={draft}
            onChange={(e) => {
              onChangeDraft(e.target.value);
              setSelectedVersionId(null);
            }}
            spellCheck={false}
            placeholder="可在此修改提示词…"
            className="input min-h-[280px] max-h-[520px] resize-y leading-relaxed font-mono text-[13px] w-full"
          />
        </div>

        {/* link-button 切换区 */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 flex-wrap">
            <LinkBtn
              active={versionsOpen}
              disabled={versionCount === 0}
              onClick={() => setVersionsOpen((v) => !v)}
            >
              <HistoryIcon className="w-3.5 h-3.5" />
              <span>历史版本 · {versionCount}</span>
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
          <button
            onClick={onResetDraft}
            disabled={!dirty}
            className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 text-zinc-600 dark:text-zinc-300 transition"
          >
            <RotateCcw className="w-3.5 h-3.5" /> 撤销修改
          </button>
          <button
            onClick={onSaveDraft}
            disabled={!dirty}
            className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md bg-violet-500 hover:bg-violet-600 disabled:opacity-40 disabled:hover:bg-violet-500 text-white transition"
          >
            <Save className="w-3.5 h-3.5" /> 保存为新版本
          </button>
          <button
            onClick={() => onCopy(draft, `draft:${item.id}`)}
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
