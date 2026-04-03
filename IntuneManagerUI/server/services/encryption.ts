import crypto from 'crypto'

const IV_LENGTH = 16

function getKey(): Buffer {
  const secret = process.env.APP_SECRET_KEY
  if (!secret) throw new Error('APP_SECRET_KEY environment variable is required')
  return crypto.createHash('sha256').update(secret).digest()
}

export function encrypt(plaintext: string): string {
  if (!plaintext) return ''
  const key = getKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return iv.toString('hex') + ':' + encrypted.toString('hex')
}

export function decrypt(ciphertext: string): string {
  if (!ciphertext) return ''
  try {
    const key = getKey()
    const [ivHex, encHex] = ciphertext.split(':')
    const iv = Buffer.from(ivHex, 'hex')
    const enc = Buffer.from(encHex, 'hex')
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
  } catch {
    return ''
  }
}
