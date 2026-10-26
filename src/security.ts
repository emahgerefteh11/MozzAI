const encoder = new TextEncoder();
function encode(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function decode(value: string): Uint8Array<ArrayBuffer> { return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0)); }
async function key(secret: string): Promise<CryptoKey> { return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']); }

export async function sign(value: object, secret: string): Promise<string> {
  const payload = encode(encoder.encode(JSON.stringify(value)));
  const signature = await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(payload));
  return payload + '.' + encode(new Uint8Array(signature));
}

export async function verify<T>(token: string | undefined, secret: string): Promise<T | null> {
  if (!token || token.length > 24000) return null;
  try {
    const [payload, signature, extra] = token.split('.');
    if (extra || !payload || !signature || !await crypto.subtle.verify('HMAC', await key(secret), decode(signature), encoder.encode(payload))) return null;
    return JSON.parse(new TextDecoder().decode(decode(payload))) as T;
  } catch { return null; }
}

export async function equalSecret(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([crypto.subtle.digest('SHA-256', encoder.encode(a)), crypto.subtle.digest('SHA-256', encoder.encode(b))]);
  const l = new Uint8Array(left), r = new Uint8Array(right);
  let difference = 0;
  for (let i = 0; i < l.length; i++) difference |= l[i] ^ r[i];
  return difference === 0;
}

export async function opaqueKey(value: string, secret: string): Promise<string> {
  return encode(new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(value))));
}

export function csvCell(value: unknown): string {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
