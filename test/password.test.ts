import { describe, expect, it } from 'vitest'
import {
  createParentPassword,
  deriveSecondHash,
  generateSalt,
  hashWithSalt,
  isValidPasswordHash,
  isValidSalt,
  verifyPassword,
} from '../src/crypto/password'

describe('password hashing', () => {
  it('generates jBCrypt compatible salts ($2a$, cost 10)', () => {
    for (let i = 0; i < 20; i++) {
      const salt = generateSalt()
      expect(salt).toMatch(/^\$2a\$10\$[./A-Za-z0-9]{22}$/)
      expect(isValidSalt(salt)).toBe(true)
    }
  })

  it('matches a known jBCrypt/OpenBSD test vector', async () => {
    // from the jBCrypt test suite
    expect(await hashWithSalt('abc', '$2a$10$WvvTPHKwdBJ3uk0Z37EMR.')).toBe(
      '$2a$10$WvvTPHKwdBJ3uk0Z37EMR.hLA2W6N9AEBhEgrAOljy2Ae5MtaSIUi',
    )
  })

  it('creates a password structure the server accepts', async () => {
    const result = await createParentPassword('geheim')

    // regexes of the server (src/util/password.ts)
    expect(result.hash).toMatch(/^(\$2a\$[123][0-9]\$[./A-Za-z0-9]{53})?$/)
    expect(result.secondHash).toMatch(/^(\$2a\$[123][0-9]\$[./A-Za-z0-9]{53})?$/)
    expect(result.secondSalt).toMatch(/^(\$2a\$[123][0-9]\$[./A-Za-z0-9]{22})?$/)
    expect(isValidPasswordHash(result.hash)).toBe(true)

    expect(result.secondHash.startsWith(result.secondSalt)).toBe(true)
    expect(result.hash.slice(0, 29)).not.toBe(result.secondSalt)

    expect(await verifyPassword('geheim', result.hash)).toBe(true)
    expect(await verifyPassword('falsch', result.hash)).toBe(false)
    expect(await deriveSecondHash('geheim', result.secondSalt)).toBe(result.secondHash)
  })

  it('rejects $2b$ salts', async () => {
    await expect(hashWithSalt('x', '$2b$10$WvvTPHKwdBJ3uk0Z37EMR.')).rejects.toThrow()
  })
})
