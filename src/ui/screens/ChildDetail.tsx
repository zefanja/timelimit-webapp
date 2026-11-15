import { useMemo, useState } from 'react'
import { actions } from '../../actions/parentActions'
import { ServerTimeLimitRule } from '../../api/types'
import { generateFamilyId } from '../../crypto/bytes'
import { CategoryState, getCategoriesOfChild, getDevicesOfUser, getUser } from '../../state/familyState'
import { formatDuration, formatTimestamp, getLocalDateInfo } from '../../logic/time'
import { useEngine, useSnapshot } from '../engine'
import { CategoryQuickActions, CategoryStatusLine } from '../components/CategoryQuick'
import { ConfirmButton, DurationInput, Icon, Modal, useAction } from '../components/common'
import { describeRule, RuleEditor } from '../components/RuleEditor'
import { WeekGrid } from '../components/WeekGrid'
import { useNow } from './Overview'

type Tab = 'categories' | 'apps' | 'settings'

export function ChildDetailScreen({ childId, onBack }: { childId: string; onBack: () => void }) {
  const snapshot = useSnapshot()
  const child = getUser(snapshot.display, childId)
  const [tab, setTab] = useState<Tab>('categories')

  if (!child) {
    return (
      <div className="card">
        <p>Dieses Kind gibt es nicht mehr.</p>
        <button onClick={onBack}>Zurück</button>
      </div>
    )
  }

  return (
    <>
      <div className="tabs" role="tablist">
        <button role="tab" className={tab === 'categories' ? 'active' : ''} onClick={() => setTab('categories')}>Kategorien &amp; Regeln</button>
        <button role="tab" className={tab === 'apps' ? 'active' : ''} onClick={() => setTab('apps')}>Apps</button>
        <button role="tab" className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>Einstellungen</button>
      </div>
      {tab === 'categories' && <CategoriesTab childId={childId} />}
      {tab === 'apps' && <AppsTab childId={childId} />}
      {tab === 'settings' && <ChildSettingsTab childId={childId} onDeleted={onBack} />}
    </>
  )
}

// ---------------- categories ----------------

function CategoriesTab({ childId }: { childId: string }) {
  const snapshot = useSnapshot()
  const engine = useEngine()
  const { busy, run } = useAction()
  const state = snapshot.display
  const child = getUser(state, childId)!
  const categories = getCategoriesOfChild(state, childId)
  const [newTitle, setNewTitle] = useState('')
  const [adding, setAdding] = useState(false)

  return (
    <>
      {categories.map((category) => (
        <CategoryCard key={category.base.categoryId} category={category} timeZone={child.timeZone} childId={childId} isDefault={child.categoryForNotAssignedApps === category.base.categoryId} />
      ))}

      {adding ? (
        <div className="card">
          <label htmlFor="newcat">Neue Kategorie</label>
          <div className="row">
            <input id="newcat" className="grow" type="text" autoFocus value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="z. B. Lernen" style={{ width: 'auto' }} />
            <button
              className="primary"
              disabled={busy || !newTitle.trim()}
              onClick={() =>
                run(async () => {
                  await engine.run(actions.createCategory({ childId, categoryId: generateFamilyId(), title: newTitle.trim() }))
                  setNewTitle('')
                  setAdding(false)
                }, 'Kategorie angelegt')
              }
            >
              Anlegen
            </button>
          </div>
        </div>
      ) : (
        <button className="block" onClick={() => setAdding(true)}>
          <Icon name="plus" /> Kategorie hinzufügen
        </button>
      )}
    </>
  )
}

function CategoryCard({ category, timeZone, childId, isDefault }: { category: CategoryState; timeZone: string; childId: string; isDefault: boolean }) {
  const snapshot = useSnapshot()
  const engine = useEngine()
  const { busy, run } = useAction()
  const now = useNow()
  const [open, setOpen] = useState(false)
  const [editRule, setEditRule] = useState<ServerTimeLimitRule | null | 'new'>(null)
  const [showWeek, setShowWeek] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(category.base.title)
  const [extraOpen, setExtraOpen] = useState(false)
  const id = category.base.categoryId

  return (
    <div className="card">
      <CategoryStatusLine state={snapshot.display} category={category} timeZone={timeZone} now={now} />
      <CategoryQuickActions category={category} timeZone={timeZone} />

      <button className="ghost block small" style={{ marginTop: 6 }} onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? 'Weniger' : 'Regeln, Sperrzeiten & mehr'}
      </button>

      {open && (
        <div className="stack" style={{ marginTop: 8 }}>
          <section>
            <div className="row spread">
              <h3>Zeitregeln</h3>
              <button className="small" onClick={() => setEditRule('new')}><Icon name="plus" /> Regel</button>
            </div>
            {category.rules.length === 0 ? (
              <p className="small muted">Keine Regeln – die Kategorie ist zeitlich unbegrenzt (außer Sperrzeiten).</p>
            ) : (
              <ul className="list">
                {category.rules.map((rule) => (
                  <li key={rule.id}>
                    <span className="grow small">{describeRule(rule)}</span>
                    <button className="icon" aria-label="Regel bearbeiten" onClick={() => setEditRule(rule)}><Icon name="edit" /></button>
                    <button className="icon" aria-label="Regel löschen" disabled={busy} onClick={() => run(() => engine.run(actions.deleteRule(rule.id)), 'Regel gelöscht')}>
                      <Icon name="trash" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <div className="row spread">
              <h3>Gesperrte Zeiten</h3>
              <button className="small" onClick={() => setShowWeek(!showWeek)}>{showWeek ? 'Schließen' : 'Wochenplan'}</button>
            </div>
            {showWeek && (
              <WeekGrid
                value={category.base.blockedTimes}
                timeZone={timeZone}
                saving={busy}
                onSave={(times) => run(() => engine.run(actions.setBlockedTimes(id, times)), 'Sperrzeiten gespeichert')}
              />
            )}
          </section>

          <section>
            <h3>Extrazeit &amp; Pause</h3>
            <div className="row">
              <button className="small" onClick={() => setExtraOpen(true)}>Extrazeit festlegen</button>
              {category.base.dlu > now ? (
                <button className="small" disabled={busy} onClick={() => run(() => engine.run(actions.setCategoryDisableLimits(id, 0)), 'Limits wieder aktiv')}>
                  Pause beenden (bis {formatTimestamp(category.base.dlu)})
                </button>
              ) : (
                <button className="small" disabled={busy} onClick={() => run(() => engine.run(actions.setCategoryDisableLimits(id, Date.now() + 60 * 60_000)), 'Limits für 1 Stunde pausiert')}>
                  Limits 1 h pausieren
                </button>
              )}
            </div>
          </section>

          <section>
            <h3>Kategorie</h3>
            <label className="check">
              <input
                type="checkbox"
                checked={isDefault}
                disabled={busy}
                onChange={(e) => run(() => engine.run(actions.setCategoryForUnassignedApps(childId, e.target.checked ? id : '')))}
              />
              Standardkategorie für Apps ohne Zuordnung
            </label>
            <p className="small muted">{category.apps.length} App(s) zugeordnet – zuordnen im Reiter „Apps“.</p>
            <div className="row">
              <button className="small" onClick={() => setRenaming(true)}><Icon name="edit" /> Umbenennen</button>
              <ConfirmButton confirm={`Kategorie „${category.base.title}“ mit allen Regeln löschen?`} onConfirm={() => run(() => engine.run(actions.deleteCategory(id)), 'Kategorie gelöscht')}>
                <Icon name="trash" /> Löschen
              </ConfirmButton>
            </div>
          </section>
        </div>
      )}

      {editRule !== null && <RuleEditor categoryId={id} rule={editRule === 'new' ? null : editRule} onClose={() => setEditRule(null)} />}

      {renaming && (
        <Modal
          title="Kategorie umbenennen"
          onClose={() => setRenaming(false)}
          actions={
            <>
              <button onClick={() => setRenaming(false)}>Abbrechen</button>
              <button
                className="primary"
                disabled={!title.trim()}
                onClick={() => run(async () => { await engine.run(actions.renameCategory(id, title.trim())); setRenaming(false) })}
              >
                Speichern
              </button>
            </>
          }
        >
          <input type="text" aria-label="Titel" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
        </Modal>
      )}

      {extraOpen && <ExtraTimeModal category={category} timeZone={timeZone} onClose={() => setExtraOpen(false)} />}
    </div>
  )
}

function ExtraTimeModal({ category, timeZone, onClose }: { category: CategoryState; timeZone: string; onClose: () => void }) {
  const engine = useEngine()
  const { busy, run } = useAction()
  const today = getLocalDateInfo(Date.now(), timeZone).dayOfEpoch
  const currentlyValid = category.base.extraTimeDay === -1 || category.base.extraTimeDay === today
  const [value, setValue] = useState(currentlyValid ? category.base.extraTime : 0)
  const [onlyToday, setOnlyToday] = useState(true)

  return (
    <Modal
      title={`Extrazeit: ${category.base.title}`}
      onClose={onClose}
      actions={
        <>
          <button onClick={onClose}>Abbrechen</button>
          <button
            className="primary"
            disabled={busy}
            onClick={() => run(async () => { await engine.run(actions.setExtraTime(category.base.categoryId, value, onlyToday ? today : -1)); onClose() }, 'Extrazeit gesetzt')}
          >
            Setzen
          </button>
        </>
      }
    >
      <p className="small muted">Aktuell: {currentlyValid ? formatDuration(category.base.extraTime) : '0 min'}{category.base.extraTimeDay === -1 && category.base.extraTime > 0 ? ' (ohne Ablaufdatum)' : ''}</p>
      <DurationInput value={value} onChange={setValue} maxHours={12} />
      <label className="check">
        <input type="checkbox" checked={onlyToday} onChange={(e) => setOnlyToday(e.target.checked)} /> nur für heute gültig
      </label>
    </Modal>
  )
}

// ---------------- apps ----------------

function AppsTab({ childId }: { childId: string }) {
  const snapshot = useSnapshot()
  const engine = useEngine()
  const { busy, run } = useAction()
  const state = snapshot.display
  const child = getUser(state, childId)!
  const categories = getCategoriesOfChild(state, childId)
  const devices = getDevicesOfUser(state, childId)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'unassigned'>('all')

  const categoryOfApp = useMemo(() => {
    const map = new Map<string, string>()
    for (const category of categories) for (const app of category.apps) map.set(app, category.base.categoryId)
    return map
  }, [categories])

  const apps = useMemo(() => {
    const map = new Map<string, { packageName: string; title: string; launchable: boolean; installed: boolean }>()
    for (const device of devices) {
      for (const app of snapshot.crypto.appLists[device.deviceId]?.apps ?? []) {
        map.set(app.packageName, { packageName: app.packageName, title: app.title || app.packageName, launchable: app.isLaunchable, installed: true })
      }
    }
    for (const packageName of categoryOfApp.keys()) {
      if (!map.has(packageName)) map.set(packageName, { packageName, title: packageName, launchable: true, installed: false })
    }
    return [...map.values()].sort((a, b) => Number(b.launchable) - Number(a.launchable) || a.title.localeCompare(b.title, 'de'))
  }, [devices, snapshot.crypto.appLists, categoryOfApp])

  const q = query.trim().toLowerCase()
  const visible = apps.filter(
    (app) =>
      (!q || app.title.toLowerCase().includes(q) || app.packageName.toLowerCase().includes(q)) &&
      (filter === 'all' || !categoryOfApp.has(app.packageName)),
  )

  const assign = (packageName: string, categoryId: string) =>
    run(() =>
      engine.run(
        categoryId === ''
          ? actions.removeCategoryApps(categoryOfApp.get(packageName)!, [packageName])
          : actions.addCategoryApps(categoryId, [packageName]),
      ),
    )

  const defaultCategory = categories.find((c) => c.base.categoryId === child.categoryForNotAssignedApps)

  const missingLists = devices.filter((device) => !snapshot.crypto.appLists[device.deviceId])

  return (
    <>
      {devices.length === 0 && <div className="banner warn">Diesem Kind ist noch kein Gerät zugewiesen – dann gibt es auch keine App-Liste.</div>}
      {missingLists.map((device) => (
        <div className="banner info" key={device.deviceId}>
          App-Liste von „{device.name}“ noch nicht verfügbar. Sie wird verschlüsselt übertragen; das Kindgerät muss online sein und den Schlüssel freigeben.
          <div style={{ marginTop: 6 }}>
            <button className="small" onClick={() => engine.requestAppListAgain(device.deviceId)}>Erneut anfordern</button>
          </div>
        </div>
      ))}

      <div className="card">
        <p className="small muted" style={{ marginBottom: 8 }}>
          Apps ohne Zuordnung: {defaultCategory ? `„${defaultCategory.base.title}“` : 'gesperrt (keine Standardkategorie)'}
        </p>
        <input type="search" placeholder="App suchen …" aria-label="App suchen" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="row" style={{ marginTop: 8 }}>
          <button className={'small' + (filter === 'all' ? ' primary' : '')} onClick={() => setFilter('all')}>Alle ({apps.length})</button>
          <button className={'small' + (filter === 'unassigned' ? ' primary' : '')} onClick={() => setFilter('unassigned')}>
            Ohne Kategorie ({apps.filter((a) => !categoryOfApp.has(a.packageName)).length})
          </button>
        </div>
        <ul className="list" style={{ marginTop: 8 }}>
          {visible.slice(0, 300).map((app) => (
            <li key={app.packageName}>
              <div className="grow">
                <div>{app.title}</div>
                <div className="small muted mono">{app.packageName}{!app.installed && ' · nicht installiert'}{!app.launchable && ' · Systemdienst'}</div>
              </div>
              <select
                aria-label={`Kategorie für ${app.title}`}
                value={categoryOfApp.get(app.packageName) ?? ''}
                disabled={busy}
                onChange={(e) => assign(app.packageName, e.target.value)}
                style={{ width: 'auto', maxWidth: '45%' }}
              >
                <option value="">– keine –</option>
                {categories.map((category) => (
                  <option key={category.base.categoryId} value={category.base.categoryId}>{category.base.title}</option>
                ))}
              </select>
            </li>
          ))}
        </ul>
        {visible.length > 300 && <p className="small muted">… {visible.length - 300} weitere, bitte Suche verwenden.</p>}
        {visible.length === 0 && <p className="small muted">Keine Apps gefunden.</p>}
      </div>
    </>
  )
}

// ---------------- settings ----------------

function ChildSettingsTab({ childId, onDeleted }: { childId: string; onDeleted: () => void }) {
  const snapshot = useSnapshot()
  const engine = useEngine()
  const { busy, run } = useAction()
  const now = useNow()
  const child = getUser(snapshot.display, childId)!
  const [name, setName] = useState(child.name)

  const tomorrow = () => {
    const date = new Date()
    date.setHours(24, 0, 0, 0)
    return date.getTime()
  }

  return (
    <>
      <div className="card">
        <h3>Name</h3>
        <div className="row">
          <input className="grow" type="text" aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 'auto' }} />
          <button disabled={busy || !name.trim() || name === child.name} onClick={() => run(() => engine.run(actions.renameChild(childId, name.trim())), 'Umbenannt')}>
            Speichern
          </button>
        </div>
      </div>

      <div className="card">
        <h3>Alle Limits pausieren</h3>
        {child.disableLimitsUntil > now ? (
          <>
            <p>Pausiert bis {formatTimestamp(child.disableLimitsUntil)}.</p>
            <button className="primary" disabled={busy} onClick={() => run(() => engine.run(actions.setUserDisableLimitsUntil(childId, 0)), 'Limits wieder aktiv')}>
              Pause beenden
            </button>
          </>
        ) : (
          <div className="row">
            <button disabled={busy} onClick={() => run(() => engine.run(actions.setUserDisableLimitsUntil(childId, Date.now() + 60 * 60_000)), 'Pausiert für 1 h')}>1 Stunde</button>
            <button disabled={busy} onClick={() => run(() => engine.run(actions.setUserDisableLimitsUntil(childId, Date.now() + 3 * 60 * 60_000)), 'Pausiert für 3 h')}>3 Stunden</button>
            <button disabled={busy} onClick={() => run(() => engine.run(actions.setUserDisableLimitsUntil(childId, tomorrow())), 'Pausiert bis Mitternacht')}>bis Mitternacht</button>
          </div>
        )}
      </div>

      <div className="card">
        <h3>Kind löschen</h3>
        <p className="small muted">Löscht das Kind mit allen Kategorien und Regeln. Zugewiesene Geräte bleiben gekoppelt.</p>
        <ConfirmButton
          confirm={`„${child.name}“ wirklich löschen? Das kann nicht rückgängig gemacht werden.`}
          onConfirm={() =>
            run(async () => {
              await engine.run(actions.removeUser(childId))
              onDeleted()
            }, 'Kind gelöscht')
          }
        >
          <Icon name="trash" /> Kind löschen
        </ConfirmButton>
      </div>
    </>
  )
}
