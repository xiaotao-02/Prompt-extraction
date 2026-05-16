/** 来自 {@link AppSettings.panelAutofocus}：是否在面板状态切换时把焦点移入编辑器（可访问性） */
let panelContentAutofocus = true;

export function applyStoredPanelAutofocus(enabled: boolean | undefined): void {
  panelContentAutofocus = enabled !== false;
}

export function shouldPanelContentAutofocus(): boolean {
  return panelContentAutofocus;
}
