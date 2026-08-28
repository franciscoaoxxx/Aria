# Guía: subir la tabla de players a GitHub

Objetivo: tener un repo con `player_configs.json` que las apps de Onda ya
instaladas bajan en caliente, y un CI que le añade la entrada cada vez que
YouTube rota el reproductor. Empujar una entrada = arreglar a todos en minutos,
sin publicar APK.

Esta guía tiene dos partes:

- **A) Repo público** — lo simple, lo recomendado para empezar.
- **B) Repo privado** — cómo hacerlo funcionar igual (3 opciones), al final.

---

## A) Repo PÚBLICO

### A.1 — Qué subir

Todo el contenido de `docs/player-configs-repo/` **tal cual**:

```
player_configs.json          ← la tabla (semilla ya incluida)
derive.mjs                    ← detecta el player rotado y propone la entrada
validate.mjs                  ← comprueba que la receta descifra de verdad
package.json                  ← dependencias del CI (jsdom)
README.md
.gitignore
.github/workflows/rotate.yml  ← el CI
```

**No subir:** `node_modules/`, `entry.json`, `derive.out` (ya están en
`.gitignore`). Tampoco subas `package-lock.json` la primera vez si no lo
generaste con `npm install` en tu máquina — el CI usa `npm ci`, que **exige**
un `package-lock.json`. Opciones:

- **A)** correr `npm install` una vez en local y subir el `package-lock.json`
  que aparezca (recomendado, builds reproducibles), **o**
- **B)** en `rotate.yml` cambiar `npm ci` por `npm install` (más simple, menos
  reproducible).

### A.2 — Crear el repo

1. En GitHub: **New repository**.
   - Nombre: `onda-player-configs` (o el que quieras).
   - **Public**.
   - **No** marques "Add a README" / "Add .gitignore" (ya los traemos).
2. Copia la URL que te da (`https://github.com/TU_USUARIO/onda-player-configs.git`).

### A.3 — Subir los archivos

Desde una terminal, en la carpeta `docs/player-configs-repo/` de Onda:

```bash
cd docs/player-configs-repo

# (opcional pero recomendado) generar el lockfile
npm install          # crea node_modules/ y package-lock.json
                     # node_modules/ NO se sube; package-lock.json SÍ

git init
git branch -M main
git add .
git commit -m "Tabla inicial de players + CI"
git remote add origin https://github.com/TU_USUARIO/onda-player-configs.git
git push -u origin main
```

> Si prefieres no usar la terminal: en la web del repo vacío, **"uploading an
> existing file"**, y arrastra los archivos. El único truco es que la carpeta
> `.github/workflows/` hay que crearla escribiendo `​.github/workflows/rotate.yml`
> como nombre al crear el archivo en la web.

### A.4 — Permitir que el CI escriba en el repo

El workflow hace `git push` (para commitear la entrada nueva). Hay que darle
permiso:

1. Repo → **Settings** → **Actions** → **General**.
2. Sección **Workflow permissions** → elegir **Read and write permissions** →
   **Save**.

(El `rotate.yml` ya pide `permissions: contents: write`, pero ese ajuste del
repo tiene que estar en "read and write" para que surta efecto.)

### A.5 — (opcional) Vídeo de prueba fijo para `validate.mjs`

`validate.mjs` necesita un vídeo que devuelva `signatureCipher`. Por defecto usa
`dQw4w9WgXcQ`. Si algún día ese deja de servir:

1. Repo → **Settings** → **Secrets and variables** → **Actions** → pestaña
   **Variables** → **New repository variable**.
2. Nombre `VALIDATION_VIDEO_ID`, valor: el id de un vídeo normal (no age-gated,
   no premium, no en vivo).

### A.6 — Probar el CI a mano

1. Repo → pestaña **Actions** → workflow **rotate** → **Run workflow** →
   **Run workflow**.
2. Míralo correr. Si el player actual ya está en la tabla, termina con
   "Nada que hacer" (normal). Si YouTube ya rotó a uno nuevo, hará `validate`
   y, si pasa, un commit `player <hash>: entrada nueva (auto)`.

A partir de ahí corre solo cada 4 h (`cron` en `rotate.yml`; puedes cambiar la
frecuencia).

### A.7 — Conectar la app

1. La URL "raw" de tu `player_configs.json` es:

   ```
   https://raw.githubusercontent.com/TU_USUARIO/onda-player-configs/main/player_configs.json
   ```

   (si tu rama por defecto es `master` en vez de `main`, cámbialo.)

2. En Onda, `app/src/main/java/com/fast/onda/download/player/PlayerConfig.kt`,
   pon esa URL en:

   ```kotlin
   private const val REMOTE_URL =
       "https://raw.githubusercontent.com/TU_USUARIO/onda-player-configs/main/player_configs.json"
   ```

3. Recompila. En `adb logcat -s OndaPlayerJs` deberías ver, al primer arranque:
   `config remota aplicada: N claves (merge M, epoch 1)` — o `HTTP 304` si el
   asset ya estaba al día.

Listo. `raw.githubusercontent.com` sirve con `ETag` y `Cache-Control`, así que
el `If-None-Match` de la app funciona y GitHub no se queja del tráfico (es CDN,
aguanta de sobra; además la app solo pega cada 6 h o ante un player desconocido).

---

## B) Repo PRIVADO

`raw.githubusercontent.com` **no** sirve archivos de un repo privado sin
autenticación. Un repo privado necesita una de estas tres soluciones. De más a
menos recomendada:

### Antes de decidir: ¿por qué privado?

`player_configs.json` **no tiene secretos** — son datos públicos del reproductor
de YouTube (los mismos que cualquiera saca del `base.js`). Las razones válidas
para privado suelen ser: no publicitar la técnica, o no dar un blanco fácil.
Para eso, la **Opción B1** (espejo público "aburrido") es más que suficiente y
no añade complejidad de credenciales.

Si necesitas control de acceso de verdad (que NADIE pueda leer la tabla), usa
**B2** (proxy con token en el servidor). Meter un token en el APK (**B3**) es el
último recurso.

---

### B1 — Repo privado + espejo público (recomendado)

El repo privado tiene el CI, el historial y el tooling. Un job copia **solo** el
`player_configs.json` ya validado a un sitio público sin nombre revelador.

**Dónde poner el espejo** (elige uno):

- **Otro repo público** `configs-cache` (nombre neutro), con un único archivo.
- **Un Gist público** (`gist.github.com`).
- **GitHub Pages** de un repo público mínimo.
- **Release** de un repo público (asset `player_configs.json`).

**Cómo:** en `rotate.yml`, tras el commit al repo privado, añade un paso que
haga push del archivo al espejo. Ejemplo con un 2º repo público:

```yaml
      - name: Publicar al espejo público
        if: steps.derive.outputs.code == '0'
        env:
          MIRROR_TOKEN: ${{ secrets.MIRROR_TOKEN }}   # PAT con contents:write SOLO en el repo espejo
        run: |
          git clone https://x-access-token:${MIRROR_TOKEN}@github.com/TU_USUARIO/configs-cache.git mirror
          cp player_configs.json mirror/player_configs.json
          cd mirror
          git config user.name  "onda-rotate"
          git config user.email "onda-rotate@users.noreply.github.com"
          git commit -am "sync $(date -u +%FT%TZ)" || exit 0
          git push
```

`MIRROR_TOKEN`: crea un **fine-grained PAT** (Settings de tu cuenta →
Developer settings → Personal access tokens → Fine-grained) con acceso **solo**
al repo `configs-cache` y permiso **Contents: Read and write**. Guárdalo en el
repo privado como **Secret** `MIRROR_TOKEN`.

La app apunta al **raw del espejo público** — sin tokens, igual que en la
sección A. El repo real, y toda la lógica, quedan privados.

---

### B2 — Proxy con el token en el servidor (control de acceso real)

Un microservicio público (gratis) guarda un token de GitHub como variable de
entorno **del servidor** (nunca llega al teléfono), lee el archivo del repo
privado y lo devuelve.

**Cloudflare Workers** (plan gratis, sin tarjeta):

```js
// worker.js
export default {
  async fetch(request, env) {
    const upstream = await fetch(
      "https://api.github.com/repos/TU_USUARIO/onda-player-configs/contents/player_configs.json?ref=main",
      {
        headers: {
          "Authorization": `Bearer ${env.GH_TOKEN}`,       // secret del Worker
          "Accept": "application/vnd.github.raw",
          "User-Agent": "onda-config-proxy",
          // pasa el ETag del cliente para poder responder 304
          ...(request.headers.get("If-None-Match")
            ? { "If-None-Match": request.headers.get("If-None-Match") } : {}),
        },
      },
    );
    const headers = new Headers();
    const etag = upstream.headers.get("ETag");
    if (etag) headers.set("ETag", etag);
    headers.set("Cache-Control", "public, max-age=1800");
    headers.set("Content-Type", "application/json");
    return new Response(upstream.status === 304 ? null : await upstream.text(), {
      status: upstream.status === 304 ? 304 : (upstream.ok ? 200 : 502),
      headers,
    });
  },
};
```

Pasos:

1. `npm i -g wrangler` → `wrangler init onda-config-proxy` → pega el `fetch` de
   arriba.
2. `wrangler secret put GH_TOKEN` → pega un **fine-grained PAT** con acceso
   **solo** al repo privado y **Contents: Read-only**.
3. `wrangler deploy`. Te da una URL tipo
   `https://onda-config-proxy.TU_SUBDOMINIO.workers.dev`.
4. En la app, `REMOTE_URL` = esa URL. El teléfono nunca ve el token; el ETag y
   el `304` siguen funcionando.

Alternativas equivalentes: Deno Deploy, Vercel Edge Function, un endpoint en tu
propio servidor. La idea es la misma: **el token vive en el servidor**.

---

### B3 — Token embebido en el APK (último recurso)

Rápido, pero un APK se descompila y el token queda a la vista. Sólo aceptable
porque la tabla no es un secreto y el token es de **solo lectura de un solo
repo**. Ponle **caducidad** (p. ej. 90 días) y anótate renovarlo.

1. Crea un **fine-grained PAT**: acceso **solo** al repo privado,
   **Contents: Read-only**, con fecha de expiración.
2. En Onda, mételo por `local.properties` (que **no** va a git), igual que el
   antiguo `googleClientId`. En `app/build.gradle.kts`:

   ```kotlin
   val playerConfigsToken: String =
       (findProperty("playerConfigsToken") as String?).orEmpty()

   // dentro de android { defaultConfig { ... } }
   buildConfigField("String", "PLAYER_CONFIGS_TOKEN", "\"$playerConfigsToken\"")
   ```

   Y en `local.properties`:

   ```
   playerConfigsToken=github_pat_xxxxxxxx
   ```

3. En `PlayerConfig.kt`, cambia la URL y añade la cabecera. La API de contenidos
   de GitHub sí sirve repos privados con token y respeta el `ETag`:

   ```kotlin
   private const val REMOTE_URL =
       "https://api.github.com/repos/TU_USUARIO/onda-player-configs/contents/player_configs.json?ref=main"

   // en fetchAndApply(), al construir el Request:
   val req = Request.Builder()
       .url(REMOTE_URL)
       .header("User-Agent", "Onda")
       .header("Accept", "application/vnd.github.raw")
       .apply {
           if (BuildConfig.PLAYER_CONFIGS_TOKEN.isNotBlank())
               header("Authorization", "Bearer ${BuildConfig.PLAYER_CONFIGS_TOKEN}")
           if (!etag.isNullOrEmpty()) header("If-None-Match", etag)
       }
       .build()
   ```

   (El `Accept: application/vnd.github.raw` hace que devuelva el archivo tal
   cual, no el JSON envoltorio de la API.)

4. **ProGuard/R8**: `BuildConfig` no se ofusca de forma útil para esto; el token
   sigue siendo extraíble. No te confíes.

---

## Resumen

| Caso | Qué apuntar en `REMOTE_URL` | Token en el teléfono |
|---|---|---|
| Repo público (A) | `raw.githubusercontent.com/.../player_configs.json` | No |
| Privado + espejo público (B1) | raw del **espejo** público | No |
| Privado + proxy (B2) | URL del Worker/función | No |
| Privado + token en APK (B3) | `api.github.com/.../contents/...` | Sí (solo-lectura, con caducidad) |

Para Onda (app cerrada que se va a vender), **A** o **B1** son las sanas: nada
de credenciales en el binario. **B2** si de verdad necesitas que la tabla no se
pueda leer sin permiso.
