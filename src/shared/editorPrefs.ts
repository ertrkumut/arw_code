/** Settings › Editor, shared by main (persisted in the IDE state) and the IDE window. */
export interface EditorPrefs {
  inlayHints: boolean
  codeVision: boolean
  unityGutter: boolean
  fontSize: number
  minimap: boolean
  wordWrap: boolean
  stickyScroll: boolean
  renderWhitespace: boolean
}

export const DEFAULT_EDITOR_PREFS: EditorPrefs = {
  inlayHints: true, codeVision: true, unityGutter: true, fontSize: 13.5, minimap: false, wordWrap: false,
  stickyScroll: true, renderWhitespace: false
}
