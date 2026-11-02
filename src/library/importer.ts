import { parseBlob } from 'music-metadata'
import { saveArt, saveFile, saveTrack, type StoredTrack } from './store'

export const AUDIO_EXT = /\.(mp3|m4a|m4b|aac|wav|aif|aiff|flac|alac|caf|ogg|opus|mp4)$/i

async function thumbnail(data: Uint8Array, mime: string): Promise<Blob | undefined> {
  try {
    const bmp = await createImageBitmap(new Blob([data as BlobPart], { type: mime }))
    const s = Math.min(1, 512 / Math.max(bmp.width, bmp.height))
    const c = new OffscreenCanvas(Math.round(bmp.width * s), Math.round(bmp.height * s))
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
    bmp.close()
    return await c.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
  } catch { return undefined }
}

function elementDuration(file: Blob): Promise<number> {
  return new Promise(res => {
    const a = new Audio(); const url = URL.createObjectURL(file)
    a.preload = 'metadata'; a.src = url
    a.onloadedmetadata = () => { res(Number.isFinite(a.duration) ? a.duration : 0); URL.revokeObjectURL(url) }
    a.onerror = () => { res(0); URL.revokeObjectURL(url) }
  })
}

export interface ImportResult { added: StoredTrack[]; failed: { name: string; reason: string }[] }

/** Parses tags, stores the audio blob + artwork in IndexedDB, returns new Track records. */
export async function importFiles(files: File[], existing: StoredTrack[], onProgress?: (done: number, total: number) => void): Promise<ImportResult> {
  const result: ImportResult = { added: [], failed: [] }
  const seen = new Set(existing.map(t => t.fingerprint))
  let done = 0
  for (const file of files) {
    try {
      if (!AUDIO_EXT.test(file.name) && !file.type.startsWith('audio/')) throw new Error('not an audio file')
      const fingerprint = `${file.name}|${file.size}|${file.lastModified}`
      if (seen.has(fingerprint)) { done++; onProgress?.(done, files.length); continue }
      let md
      try { md = await parseBlob(file, { duration: true, skipPostHeaders: true }) } catch { md = undefined }
      const common = md?.common
      let duration = md?.format.duration ?? 0
      if (!duration) duration = await elementDuration(file)
      const id = crypto.randomUUID()
      const base = file.name.replace(/\.[^.]+$/, '')
      const track: StoredTrack = {
        id, title: common?.title || base, artist: common?.artist || 'Unknown Artist',
        albumArtist: common?.albumartist || undefined, album: common?.album || 'Unknown Album',
        genre: common?.genre?.[0], composer: common?.composer?.[0], trackNo: common?.track.no ?? undefined, year: common?.year,
        duration, addedAt: Date.now(), playCount: 0, favorite: false,
        fingerprint, fileName: file.name, sampleRate: md?.format.sampleRate, codec: md?.format.codec,
        kind: /\.m4b$/i.test(file.name) || duration > 3600 ? 'audiobook' : 'music',
        lyrics: common?.lyrics?.map(l => (typeof l === 'string' ? l : l.text)).filter(Boolean).join('\n') || undefined,
        comment: common?.comment?.map(c => (typeof c === 'string' ? c : c.text)).filter(Boolean).join('\n') || undefined,
      }
      await saveFile(id, file)
      const pic = common?.picture?.[0]
      if (pic) { const t = await thumbnail(pic.data, pic.format); if (t) await saveArt(id, t) }
      await saveTrack(track)
      seen.add(fingerprint)
      result.added.push(track)
    } catch (e) {
      result.failed.push({ name: file.name, reason: e instanceof Error ? e.message : String(e) })
    }
    done++; onProgress?.(done, files.length)
  }
  return result
}
