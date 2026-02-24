// Unified icon set for GuardClaw
// All icons: currentColor, stroke-based, consistent weight

const D = { width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round" };

function I({ size = 24, className = '', children, ...rest }) {
  return <svg {...D} width={size} height={size} className={className} {...rest}>{children}</svg>;
}

// ─── Header ───
export function LockIcon(p) {
  return <I {...p}><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></I>;
}
export function UnlockIcon(p) {
  return <I {...p}><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.83-1"/></I>;
}
export function MonitorIcon(p) {
  return <I {...p}><circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49"/><path d="M7.76 16.24a6 6 0 0 1 0-8.49"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M4.93 19.07a10 10 0 0 1 0-14.14"/></I>;
}
export function BenchmarkIcon(p) {
  return <I {...p}><path d="M9 3h6"/><path d="M10 3v6.5L4.5 19a1.5 1.5 0 0 0 1.3 2.2h12.4a1.5 1.5 0 0 0 1.3-2.2L14 9.5V3"/><path d="M8.5 14h7"/></I>;
}
export function SettingsIcon(p) {
  return <I {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></I>;
}
export function SunIcon(p) {
  return <I {...p}><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></I>;
}
export function MoonIcon(p) {
  return <I {...p}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></I>;
}

// ─── Tool icons (Events) ───
export function TerminalIcon(p) { // exec
  return <I {...p}><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></I>;
}
export function FileTextIcon(p) { // read
  return <I {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></I>;
}
export function PencilIcon(p) { // write / edit
  return <I {...p}><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></I>;
}
export function GlobeIcon(p) { // web_fetch / web_search / browser
  return <I {...p}><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></I>;
}
export function SearchIcon(p) { // web_search
  return <I {...p}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></I>;
}
export function MessageIcon(p) { // message / chat
  return <I {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></I>;
}
export function BrainIcon(p) { // memory / thinking
  return <I {...p}><path d="M12 2C8.5 2 6 4.5 6 7.5c0 1.5.5 2.8 1.4 3.8L6 18h12l-1.4-6.7c.9-1 1.4-2.3 1.4-3.8C18 4.5 15.5 2 12 2z"/><path d="M10 18v2a2 2 0 0 0 4 0v-2"/><line x1="12" y1="2" x2="12" y2="7"/><line x1="9" y1="5" x2="12" y2="7"/><line x1="15" y1="5" x2="12" y2="7"/></I>;
}
export function BotIcon(p) { // agent / bot
  return <I {...p}><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><line x1="12" y1="7" x2="12" y2="11"/><line x1="8" y1="16" x2="8" y2="16.01"/><line x1="16" y1="16" x2="16" y2="16.01"/></I>;
}
export function HourglassIcon(p) { // working / pending
  return <I {...p}><path d="M5 3h14"/><path d="M5 21h14"/><path d="M7 3v4.2a4 4 0 0 0 1.2 2.8L12 14l3.8-4a4 4 0 0 0 1.2-2.8V3"/><path d="M7 21v-4.2a4 4 0 0 1 1.2-2.8L12 10l3.8 4a4 4 0 0 1 1.2 2.8V21"/></I>;
}
export function WrenchIcon(p) { // generic tool
  return <I {...p}><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></I>;
}
export function LinkIcon(p) { // chain
  return <I {...p}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></I>;
}
export function ChartIcon(p) { // stats / session_status
  return <I {...p}><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></I>;
}
export function GitBranchIcon(p) { // sessions_spawn / subagent
  return <I {...p}><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></I>;
}
export function ServerIcon(p) { // nodes
  return <I {...p}><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></I>;
}
export function ImageIcon(p) { // image
  return <I {...p}><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></I>;
}
export function BanIcon(p) { // blocked
  return <I {...p}><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></I>;
}
export function CheckIcon(p) { // success / approve
  return <I {...p}><polyline points="20 6 9 17 4 12"/></I>;
}
export function XIcon(p) { // fail / deny
  return <I {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></I>;
}
export function CpuIcon(p) { // LM Studio
  return <I {...p}><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></I>;
}
export function LlamaIcon(p) { // Ollama — simple llama silhouette via strokes
  return <I {...p}><path d="M8 4c-1 0-2 1-2 2v3c0 1-1 2-2 3v4c0 1 .5 2 1.5 2H7v2h2v-2h6v2h2v-2h1.5c1 0 1.5-1 1.5-2v-4c-1-1-2-2-2-3V6c0-1-1-2-2-2" /><circle cx="9" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="8" r="1" fill="currentColor" stroke="none"/></I>;
}
export function StarIcon(p) { // recommended
  return <I {...p}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></I>;
}
