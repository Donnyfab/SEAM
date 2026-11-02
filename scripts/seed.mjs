// Seeds 3000 songs + 40 playlists (metadata only) into the page's IndexedDB.
export async function seed(page) {
  await page.evaluate(async () => {
    const open = n => new Promise((res, rej) => { const r = indexedDB.open(n); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
    const names = ['Aurora', 'Neon', 'Static', 'Velvet', 'Midnight', 'Echo', 'Cobalt', 'Drift', 'Halo', 'Prism']
    const db = await open('seam-tracks'); const tx = db.transaction('kv', 'readwrite'); const st = tx.objectStore('kv'); st.clear()
    for (let i = 0; i < 3000; i++) { const t = { id: 'seed-' + i, title: names[i % 10] + ' ' + (i * 7919 % 9973), artist: 'Artist ' + (i % 120), album: 'Album ' + (i % 300), albumArtist: 'Artist ' + (i % 120), genre: ['Pop', 'Rock', 'Electronic', 'Jazz'][i % 4], duration: 120 + (i % 240), addedAt: Date.now() - i * 1000, playCount: i % 5, favorite: i % 17 === 0, kind: 'music', trackNo: (i % 12) + 1 }; st.put(t, t.id) }
    await new Promise(r => tx.oncomplete = r)
    const d2 = await open('seam-docs'); const t2 = d2.transaction('kv', 'readwrite'); t2.objectStore('kv').put(Array.from({ length: 40 }, (_, i) => ({ id: 'pl-' + i, name: 'Playlist ' + i, trackIds: Array.from({ length: 60 }, (_, k) => 'seed-' + ((i * 61 + k * 13) % 3000)), updatedAt: Date.now() - i, createdAt: Date.now() - i })), 'playlists'); await new Promise(r => t2.oncomplete = r)
    localStorage.setItem('seam:tab', 'playlists')
  })
}
