import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import './global.css'
import App from './App'
import { DetachedTerminalApp } from './DetachedTerminalApp'
import { toAgentId } from '@shared/agents'

import { useIde } from './store/ideStore'
import { IdeApp } from './IdeApp'

const params = new URLSearchParams(window.location.search)
const term = params.get('term')
const ide = params.get('ide')
const root = createRoot(document.getElementById('root')!)
// Theme first, so the first frame already has the right colors (also for torn-off windows).
void useIde.getState().load().finally(() => root.render(
  ide
    ? <IdeApp projectId={ide} name={params.get('name') ?? 'Project'} path={params.get('path') ?? ''} />
    : term
    ? <DetachedTerminalApp termId={term} name={params.get('name') ?? 'terminal'}
        color={params.get('color') ?? undefined} cwd={params.get('cwd') ?? ''}
        agent={toAgentId(params.get('agent'))} />
    : <App />
))
