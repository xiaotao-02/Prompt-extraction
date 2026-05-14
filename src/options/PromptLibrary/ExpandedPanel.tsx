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
import { VersionsTab } from './tabs/VersionsTab';
import { MetaTab } from './tabs/MetaTab';
import { RefineInline } from './tabs/RefineInline';

// ============== 展开面板（content panel 风格） ==============
// 编辑器始终可见并占据主空间；版本 / AI 调整 / 详情通过 link-button 就地切换。

type Section = 'versions' | 'refine' | 'meta';

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
  const [openSection, setOpenSection] = useState<Section | null>(null);

  const toggle = (s: Section) => setOpenSection((cur) => (cur === s ? null : s));

  useEffect(() => {
    if (refineLoading) setOpenSection('refine');
  }, [refineLoading]);

  const dirtyPrompt = draft.trim() !== item.prompt.trim();
  const dirtyNote = (draftNote || '') !== (item.note || '');
  const dirty = dirtyPrompt || dirtyNote;
  const versionCount = item.versions?.length || 0;

  return (
    <div className="border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/30 px-4 py-3 space-y-3">
      {/* ---- 编辑器 textarea（始终可见，主焦点） ---- */}
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
          onChange={(e) => onChangeDraft(e.target.value)}
          spellCheck={false}
          placeholder="可在此修改提示词…"
          className="input min-h-[280px] max-h-[520px] resize-y leading-relaxed font-mono text-[13px] w-full"
        />
      </div>

      {/* ---- meta-row：link-button 切换区（仿 content panel） ---- */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 flex-wrap">
          <LinkBtn
            active={openSection === 'versions'}
            disabled={versionCount === 0}
            onClick={() => toggle('versions')}
          >
            <HistoryIcon className="w-3.5 h-3.5" />
            <span>历史版本 · {versionCount}</span>
          </LinkBtn>
          <LinkBtn
            active={openSection === 'refine'}
            onClick={() => toggle('refine')}
          >
            <Wand2 className="w-3.5 h-3.5" />
            <span>AI 调整</span>
          </LinkBtn>
          <LinkBtn
            active={openSection === 'meta'}
            onClick={() => toggle('meta')}
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

      {/* ---- AI 调整（就地展开） ---- */}
      {openSection === 'refine' && (
        <RefineInline
          value={refineInput}
          loading={refineLoading}
          error={refineError}
          onChange={onChangeRefine}
          onSubmit={onRunRefine}
          onPick={onPickRefineSuggestion}
        />
      )}

      {/* ---- 操作按钮行 ---- */}
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

      {/* ---- 备注 / 标签 ---- */}
      <div className="flex items-center gap-2">
        <StickyNote className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500 flex-none" />
        <input
          className="input flex-1 text-[12px]"
          value={draftNote}
          onChange={(e) => onChangeNote(e.target.value)}
          placeholder="备注 / 标签（仅本地保存，可用于搜索）"
        />
      </div>

      {/* ---- 历史版本（就地展开） ---- */}
      {openSection === 'versions' && versionCount > 0 && (
        <VersionsTab
          item={item}
          onCopy={onCopy}
          copiedKey={copiedKey}
          onRestoreVersion={onRestoreVersion}
          onDeleteVersion={onDeleteVersion}
        />
      )}

      {/* ---- 详情（就地展开） ---- */}
      {openSection === 'meta' && <MetaTab item={item} />}
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
