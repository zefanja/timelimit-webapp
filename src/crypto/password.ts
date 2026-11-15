// Password hashing compatible with the TimeLimit Android client.
//
// The Android client uses jBCrypt: BCrypt.gensalt() (cost 10, prefix "$2a$")
// and BCrypt.hashpw(). The server only accepts "$2a$" hashes
// (regex /^\$2a\$[123][0-9]\$[./A-Za-z0-9]{53}$/), and jBCrypt can not verify
// "$2b$" hashes. bcryptjs >= 3 generates "$2b$" salts by default, so the salt
// is built by hand here.

import bcrypt from 'bcryptjs'
import { randomBytes } from './bytes'

export const BCRYPT_COST = 10

const hashRegex = /^\$2a\$[123][0-9]\$[./A-Za-z0-9]{53}$/
const saltRegex = /^\$2a\$[123][0-9]\$[./A-Za-z0-9]{22}$/

export interface ParentPasswordPayload {
  hash: string
  secondHash: string
  secondSalt: string
}

export function generateSalt(cost: number = BCRYPT_COST): string {
  const costString = cost.toString(10).padStart(2, '0')

  return '$2a$' + costString + '$' + bcrypt.encodeBase64(randomBytes(16), 16)
}

export async function hashWithSalt(password: string, salt: string): Promise<string> {
  if (!saltRegex.test(salt)) {
    throw new Error('Ungültiges bcrypt-Salt: ' + salt)
  }

  return bcrypt.hash(password, salt)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hash)
  } catch {
    return false
  }
}

/**
 * Creates the password structure used for create-family, ADD_USER (parent)
 * and CHANGE_PARENT_PASSWORD.
 *
 * - hash: checked locally by the clients (e.g. the child app when the parent signs in there)
 * - secondSalt/secondHash: secondHash is the key for signing parent actions
 */
export async function createParentPassword(password: string): Promise<ParentPasswordPayload> {
  const hash = await hashWithSalt(password, generateSalt())
  const secondSalt = generateSalt()
  const secondHash = await hashWithSalt(password, secondSalt)

  return { hash, secondHash, secondSalt }
}

/** derives the secondHash (action signing key) for an existing parent user */
export async function deriveSecondHash(password: string, secondPasswordSalt: string): Promise<string> {
  return hashWithSalt(password, secondPasswordSalt)
}

export const isValidPasswordHash = (value: string) => hashRegex.test(value)
export const isValidSalt = (value: string) => saltRegex.test(value)
