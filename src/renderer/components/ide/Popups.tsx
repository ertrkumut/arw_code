import React from 'react'
import { useNav } from '../../store/navStore'
import { ListPopup } from './ListPopup'
import { SearchEverywhere } from './SearchEverywhere'
import { RenameDialog } from './RenameDialog'
import { SettingsDialog } from './SettingsDialog'

/** Renders whichever navigation popup / dialog is open in the IDE window. */
export function Popups() {
  const p = useNav(s => s.popup)
  if (!p) return null
  switch (p.type) {
    case 'list': return <ListPopup key={p.title} {...p} />
    case 'search': return <SearchEverywhere key="se" tab={p.tab} query={p.query} />
    case 'rename': return <RenameDialog {...p} />
    case 'settings': return <SettingsDialog tab={p.tab} />
  }
}
