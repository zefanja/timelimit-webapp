# TimeLimit Web-App (Eltern)

Eine installierbare Web-App (PWA), mit der Eltern das Original-[TimeLimit](https://codeberg.org/timelimit) von Jonas Lochmann **ohne die Android-Eltern-App** verwalten – direkt aus dem Smartphone-Browser. Die App spricht mit einem **selbst gehosteten, unveränderten `timelimit-server`**. Die Kind-Handys laufen weiter mit der offiziellen TimeLimit-App (F-Droid, `io.timelimit.android.aosp.direct`) im vernetzten Modus.

**Funktionen:** Familie anlegen oder anmelden (Mail-Code), Elternpasswort-Sperre, Kinder und Kategorien verwalten, Zeitregeln (pro Tag / Wochenbudget, Zeitfenster, Sitzungen), Wochenplan für Sperrzeiten, Extrazeit, sofort sperren, Limits pausieren, App-Zuordnung (verschlüsselte App-Liste vom Kindgerät), Geräte koppeln (Code + QR), umbenennen, entfernen, Manipulationswarnungen, Live-Aktualisierung per Websocket, Premium-Freischaltung über die Admin-API, Debug-Ansicht.

## Wichtig: gleiche Adresse für App und Server

Der timelimit-server sendet CORS-Header **nur für `/admin`**. Ein Browser darf die API deshalb nicht von einer fremden Adresse aus aufrufen. Der mitgelieferte nginx-Container löst das ohne Server-Änderung: Er liefert die Web-App aus und leitet die API-Pfade (`/auth`, `/parent`, `/sync`, `/child`, `/purchase`, `/admin`, `/time`, `/socket.io`) an den Server weiter.

```
Handy-Browser ─┐                       ┌─ /            → Web-App (statisch)
Kind-Handys  ──┼─ https://tl.example ──┤
               │   (HTTPS-Proxy)       └─ /auth, /sync, … → timelimit-server:8080
```

Die **gleiche URL** wird in der Web-App und auf den Kind-Handys als Server eingetragen. Die Web-App füllt sie beim ersten Start automatisch aus.

## Betrieb (Docker / Portainer)

`docker-compose.yml` enthält Web-App, timelimit-server (aus dem Upstream-Quellcode gebaut) und MariaDB. Als Portainer-Stack anlegen und diese Variablen setzen:

| Variable | Bedeutung |
|---|---|
| `DB_PASSWORD` | Passwort für die Datenbank (Pflicht) |
| `MAIL_SENDER` | Absenderadresse der Login-Mails (Pflicht) |
| `MAIL_TRANSPORT` | nodemailer-SMTP-Konfiguration als JSON, z. B. `{"host":"smtp.example.org","port":465,"secure":true,"auth":{"user":"…","pass":"…"}}` (Pflicht – ohne kein Login) |
| `MAIL_WHITELIST` | optional: nur diese Adresse(n)/Domains dürfen sich anmelden, z. B. die eigene |
| `DISABLE_SIGNUP` | `yes`, nachdem die eigene Familie angelegt ist |
| `ALWAYS_PRO` | `yes` (Standard hier) schaltet alle Premium-Funktionen frei |
| `ADMIN_TOKEN` | optional, für die Admin-API (Premium-Freischaltung aus der App) |
| `WEB_PORT` | Port des Web-Containers auf dem Host (Standard 8080) |

Davor gehört ein **Reverse Proxy mit HTTPS** (Traefik, Caddy, Nginx Proxy Manager …), der auf `web:80` zeigt und Websockets durchlässt. PWA-Installation, Service Worker und Web Crypto funktionieren nur in einem sicheren Kontext (HTTPS oder `localhost`).

Wenn der timelimit-server schon läuft, genügt der Web-Container allein:

```bash
docker build -t timelimit-webapp .
```

```bash
docker run -d -p 8080:80 -e TIMELIMIT_UPSTREAM=http://timelimit-host:8080 timelimit-webapp
```

> **Hinweis zur Datenbank-Variable:** Der Upstream-Server liest `DATABASE_URL`. Der GitHub-Spiegel `michaelsp/timelimit-server` liest stattdessen `DB_DRIVER`, `DB_HOST`, `DB_USER`, `DB_PASS` und `DB_NAME`. In seinem aktuellen Stand sind außerdem die Datenbank-Migrationen defekt (beim Test für diese App musste die Datei `build/database/migration/umzug.js` lokal angepasst werden). Deshalb wird hier der Upstream von Codeberg gebaut.

### Premium

Ohne `ALWAYS_PRO=yes` lehnt der Server nach der Testphase einige Aktionen ab (z. B. Extrazeit, Sperren). Die App zeigt das an. Alternative: `ADMIN_TOKEN` setzen und unter **Einstellungen → Premium** freischalten. Die App ruft dann `POST /admin/unlock-premium` mit der Mail-Adresse des angemeldeten Elternteils auf.

## Ersteinrichtung

1. Web-App öffnen → Server-Adresse bestätigen → Mail-Adresse → Code aus der Mail.
2. **Familie anlegen** (Name, Elternpasswort) oder **anmelden**, wenn es zur Mail schon eine Familie gibt.
3. Kind anlegen (optional mit den Standardkategorien „Erlaubte Apps“ und „Spiele“).
4. **Geräte → Kindgerät hinzufügen**: Auf dem Kind-Handy TimeLimit öffnen → vernetzter Modus → eigene Server-Adresse → „Als Kindgerät hinzufügen“ → Code eingeben oder QR-Code scannen. Danach das Gerät dem Kind zuweisen.
5. Auf dem Kind-Handy kann man sich mit demselben Elternpasswort als Elternteil anmelden.

Die App-Liste des Kindgeräts wird von TimeLimit **Ende-zu-Ende-verschlüsselt** hochgeladen. Die Web-App fragt den Schlüssel beim Kindgerät an (Curve25519-Schlüsselaustausch wie in der Android-App). Das Kindgerät muss dafür einmal online sein und synchronisieren. Bis dahin zeigt der Reiter „Apps“ einen Hinweis und die Schaltfläche „Erneut anfordern“.

## Sicherheit

- Das Elternpasswort wird nie gespeichert oder übertragen. Gespeichert werden bcrypt-Hashes (`$2a$10$`, kompatibel mit jBCrypt in der Android-App). Den daraus abgeleiteten Signaturschlüssel (`secondHash`) hält die App nur im Speicher, bei „entsperrt bleiben“ zusätzlich im `sessionStorage` des Tabs.
- Im `localStorage` liegen Server-URL, Geräte-Token, Sequenznummer, ausstehende Änderungen, eine Kopie der Familiendaten und die Schlüssel für die App-Listen. Wer Zugriff auf das entsperrte Browserprofil hat, kann das Geräte-Token lesen. Für Änderungen braucht man aber weiterhin das Elternpasswort, weil der Server jede Eltern-Aktion per HMAC prüft.
- Wird der Browserspeicher geleert, meldet man sich neu per Mail an. Dabei entsteht ein neues Elterngerät; das alte unter „Geräte“ entfernen.

## Entwicklung

```bash
npm install
```

```bash
docker compose -f docker-compose.dev.yml up -d
```

```bash
npm run dev
```

Im Entwicklungsmodus stehen die Login-Codes im Server-Log (`docker compose -f docker-compose.dev.yml logs -f timelimit`). Der Vite-Server leitet die API an `http://localhost:8080` weiter, ein anderer Server lässt sich mit `TIMELIMIT_SERVER=…` angeben.

### Tests

```bash
npm test
```

Mit einem gebauten Checkout des Servers (`npm install && npx tsc` im Server-Verzeichnis) prüfen die Tests zusätzlich gegen den Server-Code. Dabei kommen dessen Request-Validator, der Aktions-Parser, die JSON-Schemas aus `docs/schema` und die Binär-Hilfsfunktionen für die HMAC zum Einsatz:

```bash
TIMELIMIT_SERVER_DIR=../timelimit-server npm test
```

### Smoke-Test gegen einen echten Server (ohne UI)

```bash
npm run smoke -- --server http://localhost:8080 --log ./server.log --simulate-child
```

Der Test meldet sich per Mail an und legt eine Familie an. Er prüft die Passwort-Verifikation, legt Kind, Kategorie, Regel und Sperrzeiten an und testet Extrazeit und Sperren. Er prüft, dass eine falsche Signatur erkannt wird, koppelt ein simuliertes Kindgerät, entschlüsselt dessen App-Liste, ordnet Apps zu und kontrolliert, dass die Änderungen beim Kindgerät ankommen. Ohne `--log` fragt er den Mail-Code im Terminal ab.

## Aufbau

```
src/
  api/        fetch-Client mit typisierten Fehlern, auth/parent/sync/admin, socket.io
  crypto/     bcrypt (jBCrypt-kompatibel), HMAC-Integrität, Crypt-Container, Curve25519
  proto/      Protobuf-Decoder für die App-Liste (applist.proto)
  actions/    typisierte Eltern- und App-Logik-Aktionen (Feldnamen wie im Server)
  state/      Familienzustand aus pull-status (inkrementell), Speicher-Abstraktion
  logic/      Zeitzonen, Restzeit-Berechnung, Sperrzeiten-Bitmaske, optimistische Anzeige
  sync/       SyncEngine (Warteschlange, Push/Pull, Live-Updates), Einrichtung, App-Listen-Schlüssel
  ui/         React-Oberfläche (mobil zuerst, Deutsch)
```

Protokoll-Eckpunkte:

- Jede Eltern-Aktion wird mit `password:` und Base64(HMAC-SHA256(secondHash, uint64BE(seq) ‖ uint32BE(len) ‖ deviceId ‖ uint32BE(len) ‖ action)) signiert.
- Sequenznummern steigen pro Gerät streng. Nach Netzwerkfehlern werden dieselben Nummern erneut gesendet; der Server ignoriert Duplikate.
- Der Server meldet abgelehnte Aktionen nur über `shouldDoFullSync: true`. Die App zeigt dann an, welche Änderungen betroffen sein können, und lädt alles neu.
- Höchstens 50 Aktionen pro Request.

Getestet mit timelimit-server API-Level 9 (Stand November 2026).

## Lizenz

MIT für diese Web-App. Server und Android-App von TimeLimit stehen unter AGPL-3.0 bzw. GPL-3.0. Aus ihnen wurde kein Code übernommen; das Protokoll wurde anhand der Quellen nachimplementiert.
