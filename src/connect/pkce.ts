function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** 48 random bytes produce exactly 64 unpadded base64url characters. */
export function generateVerifier(): string {
  return base64url(globalThis.crypto.getRandomValues(new Uint8Array(48)))
}

export async function challengeFor(verifier: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(digest))
}

/** Callers must retain this value and compare it with the OAuth callback state. */
export function randomState(): string {
  return base64url(globalThis.crypto.getRandomValues(new Uint8Array(32)))
}
