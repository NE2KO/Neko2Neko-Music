import { createHmac } from 'node:crypto';

export function createToken(secretKey, payload) {
  const exp = Math.floor(Date.now() / 1000) + 300;
  const data = JSON.stringify({ ...payload, exp });
  const signature = createHmac('sha256', secretKey).update(data).digest('hex');
  return `${Buffer.from(data).toString('base64url')}:${signature}`;
}

export function verifyToken(secretKey, token) {
  try {
    const [payloadB64, signature] = token.split(':');
    if (!payloadB64 || !signature) return { valid: false, reason: 'Invalid token format' };

    const payloadStr = Buffer.from(payloadB64, 'base64url').toString('utf-8');
    const payload = JSON.parse(payloadStr);

    if (Date.now() / 1000 > payload.exp) {
      return { valid: false, reason: 'Token expired' };
    }

    const expectedSig = createHmac('sha256', secretKey).update(payloadStr).digest('hex');
    if (signature !== expectedSig) {
      return { valid: false, reason: 'Invalid signature' };
    }

    return { valid: true, payload };
  } catch (err) {
    return { valid: false, reason: err.message };
  }
}
