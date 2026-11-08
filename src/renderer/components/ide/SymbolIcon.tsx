import React from 'react'
import { FileIcon } from '../FileIcons'

/** Rider-style symbol badges: a colored letter per symbol kind. */
const LETTER: Record<string, string> = {
  class: 'C', record: 'R', struct: 'S', interface: 'I', enum: 'E', delegate: 'D', method: 'm', constructor: 'c',
  property: 'p', indexer: 'p', field: 'f', const: 'k', event: 'e', enumMember: 'v', namespace: 'N', local: 'l',
  keyword: 'K', unity: '◆', unityMessage: '◆', usage: '›', search: '⌕', web: '↗', template: '{}', bookmark: '★',
  action: '⚡', setting: '⚙'
}

export function SymbolIcon({ kind, name }: { kind?: string; name?: string }) {
  if (kind === 'file') return <FileIcon name={name ?? ''} />
  if (!kind) return <span className="sym-ico k-none" />
  return <span className={`sym-ico k-${kind}`}>{LETTER[kind] ?? kind.charAt(0)}</span>
}
