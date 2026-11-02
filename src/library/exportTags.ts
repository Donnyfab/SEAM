import { loadArt, loadFile } from './store'
import { writeTags } from './tagwriter'
import { notify, trackById } from '../state'
import { saveBlob } from '../ui/common'

/** Writes the tags you edited in SEAM into a copy of the audio file (MP3 and FLAC only). The stored original is untouched. */
export async function exportWithTags(id: string) {
  const t = trackById.peek().get(id); const blob = await loadFile(id)
  if (!t || !blob) return notify('Audio file missing from storage')
  const art = await loadArt(id)
  const res = writeTags(new Uint8Array(await blob.arrayBuffer()), {
    title: t.title, artist: t.artist, albumArtist: t.albumArtist, album: t.album, genre: t.genre, composer: t.composer,
    year: t.year, trackNo: t.trackNo, comment: t.comment, lyrics: t.lyrics,
    artwork: art ? { data: new Uint8Array(await art.arrayBuffer()), mime: art.type || 'image/jpeg' } : undefined,
  })
  if ('error' in res) return notify(`Can't write tags: ${res.error}`)
  const ext = res.format === 'mp3' ? 'mp3' : 'flac'
  await saveBlob(new Blob([res.bytes as BlobPart], { type: res.format === 'mp3' ? 'audio/mpeg' : 'audio/flac' }), `${t.artist} - ${t.title}.${ext}`)
}
