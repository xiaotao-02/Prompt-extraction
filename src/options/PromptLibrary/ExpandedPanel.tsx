import * as React from 'react';
import { Pencil, History as HistoryIcon, Wand2, Info, ImageIcon } from 'lucide-react';
import type { HistoryItem, PromptVersion } from '@/lib/types';
import type { ExpandedTab } from './types';
import { EditorTab } from './tabs/EditorTab';
import { VersionsTab } from './tabs/VersionsTab';
import { MetaTab } from './tabs/MetaTab';
import { RefineInline } from './tabs/RefineInline';

// ============== 展开面板 ==============

export function ExpandedPanel({
  item,
  tab,
  onChangeTab,
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
  tab: ExpandedTab;
  onChangeTab: (t: ExpandedTab) => void;
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
  const dirtyPrompt = draft.trim() !== item.prompt.trim();
  const dirtyNote = (draftNote || '') !== (item.note || '');
  const dirty = dirtyPrompt || dirtyNote;

  return (
    <div className="border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/30 px-4 py-4 space-y-3">
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
        {/* 左侧：大图 */}
        <div className="rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-center justify-center min-h-[220px] max-h-[320px]">
          {item.imageUrl ? (
            <img
              src={item.imageUrl}
              alt=""
              className="max-w-full max-h-[320px] object-contain"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <ImageIcon className="w-10 h-10 text-zinc-300" />
          )}
        </div>

        {/* 右侧：Tab + 内容 */}
        <div className="space-y-3 min-w-0">
          <TabBar
            tab={tab}
            onChange={onChangeTab}
            versionCount={item.versions.length}
            dirty={dirty}
          />

          {tab === 'editor' && (
            <EditorTab
              item={item}
              draft={draft}
              draftNote={draftNote}
              onChangeDraft={onChangeDraft}
              onChangeNote={onChangeNote}
              onSaveDraft={onSaveDraft}
              onResetDraft={onResetDraft}
              onCopy={onCopy}
              copiedKey={copiedKey}
              dirty={dirty}
            />
          )}
          {tab === 'versions' && (
            <VersionsTab
              item={item}
              onCopy={onCopy}
              copiedKey={copiedKey}
              onRestoreVersion={onRestoreVersion}
              onDeleteVersion={onDeleteVersion}
            />
          )}
          {tab === 'refine' && (
            <RefineInline
              value={refineInput}
              loading={refineLoading}
              error={refineError}
              onChange={onChangeRefine}
              onSubmit={onRunRefine}
              onPick={onPickRefineSuggestion}
            />
          )}
          {tab === 'meta' && <MetaTab item={item} />}
        </div>
      </div>
    </div>
  );
}

function TabBar({
  tab,
  onChange,
  versionCount,
  dirty,
}: {
  tab: ExpandedTab;
  onChange: (t: ExpandedTab) => void;
  versionCount: number;
  dirty: boolean;
}) {
  const tabs: { id: ExpandedTab; icon: React.ReactNode; label: string; badge?: React.ReactNode }[] = [
    {
      id: 'editor',
      icon: <Pencil className="w-3.5 h-3.5" />,
      label: '编辑',
      badge: dirty ? (
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
      ) : null,
    },
    {
      id: 'versions',
      icon: <HistoryIcon className="w-3.5 h-3.5" />,
      label: '版本',
      badge: (
        <span className="ml-1 text-[10px] text-zinc-400 dark:text-zinc-500 tabular-nums">
          {versionCount}
        </span>
      ),
    },
    {
      id: 'refine',
      icon: <Wand2 className="w-3.5 h-3.5" />,
      label: 'AI 调整',
    },
    {
      id: 'meta',
      icon: <Info className="w-3.5 h-3.5" />,
      label: '详情',
    },
  ];
  return (
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-zinc-100 dark:bg-zinc-800/60 flex-wrap">
      {tabs.map((t) => {
        const active = tab === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md transition ${
              active
                ? 'bg-white dark:bg-zinc-900 text-violet-600 dark:text-violet-300 shadow-sm'
                : 'text-zinc-600 dark:text-zinc-300 hover:text-zinc-800 dark:hover:text-white'
            }`}
          >
            {t.icon}
            {t.label}
            {t.badge}
          </button>
        );
      })}
    </div>
  );
}
