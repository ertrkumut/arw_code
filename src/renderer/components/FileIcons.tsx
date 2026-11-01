import React from 'react'

export const Chevron = ({ open }: { open: boolean }) => (
  <svg className="fx-chev" width="16" height="16" viewBox="0 0 16 16"
    style={{ transform: open ? 'rotate(90deg)' : undefined }}>
    <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
export const FolderIcon = ({ open }: { open: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" className="fx-ico fx-folder">
    {open
      ? <path d="M1.5 4.5a1 1 0 0 1 1-1h3.3l1.4 1.5h5.3a1 1 0 0 1 1 1V6H4.2a1 1 0 0 0-.95.68L1.5 12V4.5zm2.6 2.2h10.6l-1.9 5.6a1 1 0 0 1-.95.7H2.3l1.8-6.3z" fill="currentColor" />
      : <path d="M1.5 4.5a1 1 0 0 1 1-1h3.3l1.4 1.5h6.3a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4.5z" fill="currentColor" />}
  </svg>
)
export const EXT_COLORS: Record<string, string> = {
  ts: '#5B9BF2', tsx: '#5B9BF2', js: '#E6C76A', jsx: '#E6C76A', mjs: '#E6C76A', cjs: '#E6C76A',
  json: '#F2C57C', md: '#82AAFF', css: '#C792EA', scss: '#E879C9', html: '#F2A86C',
  py: '#7DD3FC', cs: '#9BE5A8', rs: '#F2A86C', go: '#67E8F0', java: '#EB6F77',
  png: '#B7A8F5', jpg: '#B7A8F5', jpeg: '#B7A8F5', gif: '#B7A8F5', svg: '#F2A86C', ico: '#B7A8F5',
  yml: '#EB6F77', yaml: '#EB6F77', toml: '#A6ADC0', lock: '#69708A', sh: '#7FD88F', ps1: '#82AAFF',
  unity: '#E7EAF3', prefab: '#82AAFF', meta: '#474E63', shader: '#C792EA', txt: '#A6ADC0'
}
export const FileIcon = ({ name }: { name: string }) => {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className="fx-ico" style={{ color: EXT_COLORS[ext] ?? '#8A93AB' }}>
      <path d="M4 1.5h5.2L12.5 4.8V14a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5z" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <path d="M9 1.7V5h3.3" fill="none" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  )
}
