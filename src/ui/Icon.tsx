/** Small stroke icon set (SF-Symbols-like weight) used by the Playlists UI. */
const P: Record<string, string> = {
  plus: 'M12 5v14M5 12h14',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-4.3-4.3',
  play: 'M7 5l12 7-12 7z',
  shuffle: 'M3 7h3c3 0 5 2 6 5s3 5 6 5h3M3 17h3c1.5 0 2.7-.6 3.7-1.6M14.3 8.6C15.3 7.6 16.5 7 18 7h3M18 4l3 3-3 3M18 14l3 3-3 3',
  playNext: 'M5 5l9 7-9 7zM18 5v14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  checkCircle: 'M12 3a9 9 0 100 18 9 9 0 000-18zM8 12.5l3 3 5-6',
  circle: 'M12 3a9 9 0 100 18 9 9 0 000-18z',
  sort: 'M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  list: 'M4 7h16M4 12h16M4 17h16',
  help: 'M12 3a9 9 0 100 18 9 9 0 000-18zM9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1-1.5 2M12 17h.01',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M9 9h.01',
  export: 'M12 3v12M8 7l4-4 4 4M5 13v6h14v-6',
  archive: 'M3 5h18v4H3zM5 9v10h14V9M10 13h4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  addSong: 'M9 18V6l10-2v12M9 18a3 3 0 11-6 0 3 3 0 016 0zM19 16a3 3 0 11-6 0 3 3 0 016 0zM21 3v4M19 5h4',
  rearrange: 'M8 9l4-4 4 4M8 15l4 4 4-4',
  chevL: 'M15 5l-7 7 7 7',
  chevR: 'M9 5l7 7-7 7',
  queue: 'M4 7h12M4 12h12M4 17h7M18 14v6M15 17h6',
  later: 'M4 7h16M4 12h10M4 17h7M17 15l3 3-3 3',
  rename: 'M4 8h13M4 16h8M16 14l4 4M20 14l-4 4',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  minus: 'M5 12h14',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.600-7 10-7 10z',
  music: 'M9 18V6l10-2v12M9 18a3 3 0 11-6 0 3 3 0 016 0zM19 16a3 3 0 11-6 0 3 3 0 016 0z',
  restore: 'M4 12a8 8 0 108-8M4 4v5h5',
}
export type IconName = keyof typeof P
export function Icon({ name, size = 22, fill }: { name: IconName; size?: number; fill?: boolean }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill={fill ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={P[name]} /></svg>
}
