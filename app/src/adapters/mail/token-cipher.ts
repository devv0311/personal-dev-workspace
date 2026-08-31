// TokenCipher — AES-256-GCM envelope for stored mail credentials
// (T3.3-CORRECTION).
//
// What this exists to prevent, and what it deliberately does NOT claim:
//
//   • A mail refresh token is a long-lived key to somebody's mailbox. It is
//     never written to the database in the clear, never logged, and never put
//     into an HTTP response. It is sealed here and opened here, and it exists
//     in plaintext only for the duration of one provider call.
//   • The key comes from the environment (`MAIL_TOKEN_KEY`) and from nowhere
//     else. There is no default key, no key derived from a constant, and no
//     fallback that "works without configuration" — a deployment without a key
//     cannot connect a mailbox at all, and the UI says exactly that. An
//     insecure shortcut here would be worse than the missing feature.
//   • This is envelope encryption at the application layer, not a KMS. It
//     protects the credential at rest in the datastore; it does not protect it
//     from someone who already holds both the database and the process
//     environment. Named honestly so it is not mistaken for more than it is.
//
// GCM gives authenticity as well as secrecy: a tampered ciphertext fails to
// open rather than yielding a wrong token. `keyId` is a fingerprint of the key
// used, so a rotated key is reported as "cannot decrypt with the current key"
// instead of silently failing an authentication later.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { SealedToken, TokenCipher } from '../../ports/mail.ts';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit nonce, the GCM standard
const KEY_BYTES = 32;

/** Accepts base64 or hex; anything that is not exactly 32 bytes is refused. */
function parseKey(raw: string | null): { key: Buffer | null; reason: string | null } {
  if (!raw || !raw.trim()) {
    return {
      key: null,
      reason:
        'No mail token key is configured (MAIL_TOKEN_KEY). Mail credentials cannot be stored securely, so connecting a mailbox is disabled.',
    };
  }
  const value = raw.trim();
  const candidates: Array<Buffer | null> = [
    /^[0-9a-fA-F]{64}$/.test(value) ? Buffer.from(value, 'hex') : null,
    (() => {
      try {
        return Buffer.from(value, 'base64');
      } catch {
        return null;
      }
    })(),
  ];
  const key = candidates.find((b) => !!b && b.length === KEY_BYTES) ?? null;
  if (!key) {
    return {
      key: null,
      reason:
        'MAIL_TOKEN_KEY must be 32 bytes, hex- or base64-encoded. Mail credentials cannot be stored securely, so connecting a mailbox is disabled.',
    };
  }
  return { key, reason: null };
}

export function makeTokenCipher(rawKey: string | null): TokenCipher {
  const { key, reason } = parseKey(rawKey);
  const keyId = key ? createHash('sha256').update(key).digest('hex').slice(0, 12) : '';

  return {
    available() {
      return key ? { ok: true, reason: null } : { ok: false, reason };
    },

    seal(plaintext: string): SealedToken {
      if (!key) throw new Error(reason ?? 'mail token key unavailable');
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGO, key, iv);
      const ciphertext = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
      ]);
      return { ciphertext, iv, authTag: cipher.getAuthTag(), keyId };
    },

    open(sealed: SealedToken): string {
      if (!key) throw new Error(reason ?? 'mail token key unavailable');
      if (sealed.keyId !== keyId) {
        throw new Error(
          'This credential was sealed with a different mail token key. Reconnect the account.',
        );
      }
      const decipher = createDecipheriv(ALGO, key, sealed.iv);
      decipher.setAuthTag(sealed.authTag);
      return Buffer.concat([
        decipher.update(sealed.ciphertext),
        decipher.final(),
      ]).toString('utf8');
    },
  };
}
