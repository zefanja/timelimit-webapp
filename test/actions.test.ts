import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Ajv from 'ajv'
import { describe, expect, it } from 'vitest'
import { actions, ParentAction } from '../src/actions/parentActions'
import { createParentPassword } from '../src/crypto/password'
import { hasServerBuild, hasServerSchemas, requireFromServer, serverDir } from './helpers'

const id = (n: number) => ('abc' + n).padEnd(6, 'x').slice(0, 6)

async function sampleActions(): Promise<Array<ParentAction>> {
  const password = await createParentPassword('geheim')

  return [
    actions.addChild({ userId: id(1), name: 'Kind', timeZone: 'Europe/Berlin' }),
    { type: 'ADD_USER', name: 'Mama', userType: 'parent', userId: id(2), password, timeZone: 'Europe/Berlin' },
    actions.removeUser(id(1)),
    actions.renameChild(id(1), 'Neuer Name'),
    actions.setDeviceUser(id(3), id(1)),
    actions.setDeviceUser(id(3), ''),
    actions.createCategory({ childId: id(1), categoryId: id(4), title: 'Spiele' }),
    actions.deleteCategory(id(4)),
    actions.renameCategory(id(4), 'Videos'),
    actions.addCategoryApps(id(4), ['com.example.a', 'com.example.b', 'com.example.a']),
    actions.removeCategoryApps(id(4), ['com.example.a']),
    actions.setCategoryForUnassignedApps(id(1), id(4)),
    actions.setCategoryForUnassignedApps(id(1), ''),
    actions.createRule({ ruleId: id(5), categoryId: id(4), time: 3_600_000, days: 127, extraTime: false }),
    actions.createRule({ ruleId: id(5), categoryId: id(4), time: 0, days: 31, extraTime: true, start: 60, end: 120, dur: 600_000, pause: 300_000, perDay: true }),
    actions.updateRule({ ruleId: id(5), time: 1_800_000, days: 96, extraTime: true }),
    actions.deleteRule(id(5)),
    actions.setBlockedTimes(id(4), '0,60,1200,1440'),
    actions.setBlockedTimes(id(4), ''),
    actions.incrementExtraTime(id(4), 15 * 60_000),
    actions.incrementExtraTime(id(4), 15 * 60_000, 20000),
    actions.setExtraTime(id(4), 0),
    actions.setTemporarilyBlocked(id(4), true),
    actions.setTemporarilyBlocked(id(4), true, Date.now() + 3_600_000),
    actions.setTemporarilyBlocked(id(4), false),
    actions.setCategoryDisableLimits(id(4), Date.now() + 3_600_000),
    actions.setCategoryDisableLimits(id(4), 0),
    actions.setUserDisableLimitsUntil(id(1), Date.now() + 3_600_000),
    actions.renameDevice(id(3), 'Tablet'),
    actions.ignoreAllManipulation(id(3)),
  ]
}

describe('parent actions', () => {
  it('have stable field names', async () => {
    const list = await sampleActions()
    expect(list.find((a) => a.type === 'INCREMENT_CATEGORY_EXTRATIME')).toEqual({
      type: 'INCREMENT_CATEGORY_EXTRATIME',
      categoryId: id(4),
      addedExtraTime: 900000,
      day: -1,
    })
    expect(list.find((a) => a.type === 'UPDATE_TIMELIMIT_RULE')).toEqual({
      type: 'UPDATE_TIMELIMIT_RULE',
      ruleId: id(5),
      time: 1_800_000,
      days: 96,
      extraTime: true,
      start: 0,
      end: 1439,
      dur: 0,
      pause: 0,
      perDay: false,
    })
    expect((list.find((a) => a.type === 'ADD_CATEGORY_APPS') as { packageNames: Array<string> }).packageNames).toEqual([
      'com.example.a',
      'com.example.b',
    ])
  })

  it.skipIf(!hasServerSchemas)('validate against docs/schema/SerializedParentAction.schema.json', async () => {
    const schema = JSON.parse(readFileSync(resolve(serverDir!, 'docs/schema/SerializedParentAction.schema.json'), 'utf8'))
    const ajv = new Ajv({ strict: false, allErrors: true })
    const validate = ajv.compile(schema)

    for (const action of await sampleActions()) {
      const valid = validate(JSON.parse(JSON.stringify(action)))
      expect(valid, action.type + ': ' + JSON.stringify(validate.errors)).toBe(true)
    }
  })

  it.skipIf(!hasServerBuild)('are accepted by the server validator and parser', async () => {
    const { isSerializedParentAction } = requireFromServer('build/api/validator.js')
    const { parseParentAction } = requireFromServer('build/action/serialization/index.js')

    for (const action of await sampleActions()) {
      const encoded = JSON.parse(JSON.stringify(action))
      expect(isSerializedParentAction(encoded), action.type).toBe(true)
      expect(() => parseParentAction(encoded), action.type).not.toThrow()
    }
  })
})
