# onda-player-configs

Tabla de "recetas" de descifrado del reproductor de YouTube, servida como **un
solo JSON** que las apps de Onda ya instaladas bajan en caliente. Empujar una
entrada nueva aquí arregla las descargas de todo el mundo **en minutos, sin
publicar APK**.

Esta carpeta es una **plantilla**: cópiala a un repo propio de GitHub (p. ej.
`TU_USUARIO/onda-player-configs`), y en la app pon esa URL raw en
`PlayerConfigTable.REMOTE_URL` (`app/.../download/player/PlayerConfig.kt`):

```
https://raw.githubusercontent.com/TU_USUARIO/onda-player-configs/main/player_configs.json
```

## Cómo funciona (lado app)

`PlayerConfigTable` (en Onda):

1. Trae bundleado `app/src/main/assets/player_configs.json` como default offline.
2. Al arrancar baja este `player_configs.json` (TTL 6 h + `ETag` → `304`).
3. Cuando aparece un player que **no** está en la tabla, fuerza el refresco al
   instante (rate-limited a 5 min). Si la entrada ya está publicada aquí, la
   descarga se recupera a mitad de sesión.
4. `epoch` sube cuando la tabla cambia → el `CipherWebView` se rearma con la
   receta corregida sin reiniciar la app.

## Esquema (`schemaVersion: 1`)

```json
{
  "schemaVersion": 1,
  "players": {
    "06ab6907": { "sig": "vQ(28,4062,INPUT)", "nClass": "TW", "sts": 20690, "aliases": ["5bb4f348"] }
  }
}
```

- **clave** — hash de 8 hex de la URL del `player_ias` (`/s/player/<hash>/…`).
- **`aliases`** — md5 (primeros 10 000 bytes de `base.js`), 4 bytes hex: la
  llave de respaldo cuando la URL no trae hash.
- **`sig`** — llamada JS que descifra la firma, forma fija `name(int,int,INPUT)`.
  Sale **tal cual** del sitio de llamada del `base.js`:
  `…&&(p=vQ(28,4062,ki(26,249,p)))` → `vQ(28,4062,INPUT)`.
- **`nClass`** — la clase-URL con la que el player hace el `n`-transform:
  `(new g.TW(url,!0)).get("n")` → `TW`.
- **`sts`** — el `signatureTimestamp` del player.

Regla de seguridad: cada valor termina evaluándose como JS dentro del WebView de
la app, así que `sig` está bloqueado a `name(int,int,INPUT)` y `nClass` a un
identificador corto. No metas nada más.

## Añadir un player rotado

```
npm ci
node derive.mjs            # detecta el player actual y propone la entrada
node validate.mjs <hash>   # comprueba que descifra de verdad
```

`derive.mjs` saca `sig` / `nClass` / `sts` por regex del `base.js` (los
constantes están literalmente en el sitio de llamada). `validate.mjs` corre el
descifrado real en `jsdom` sobre un `signatureCipher` de verdad y verifica que
la firma cambia y tiene forma válida, y que el `n` se transforma.

> La prueba de oro es que el CDN devuelva **HTTP 206** con la URL ya descifrada
> — eso necesita un PO Token en el runner. `validate.mjs` hace la verificación
> "en seco" (forma + que cambie); si montas PO Token en CI, añade el 206 ahí.

Luego pega la entrada en `player_configs.json`, corre los dos scripts otra vez
para confirmar, y haz push a `main`.

## CI

`.github/workflows/rotate.yml` corre `derive.mjs` cada pocas horas; si detecta un
hash nuevo, corre `validate.mjs`, y si pasa hace commit de la entrada y push.
Un humano puede revisar el PR/commit, pero no hace falta para que las apps se
reparen.
