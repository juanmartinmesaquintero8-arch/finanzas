# Plan de implementación: endurecimiento de seguridad

> **Cómo ejecutarlo:** una tarea a la vez, con revisión entre tareas.
> Los pasos usan casillas (`- [ ]`) para el seguimiento. Cada etapa va en su propia rama y worktree.

**Objetivo:** cerrar los hallazgos de seguridad de la auditoría del 2026-11-07 que afectan la app del
celular y dejar la versión de computador escuchando solo en local.

**Arquitectura:**
- Parches de dependencias dentro de la misma familia de versiones.
- CSP por `<meta>` en la PWA estática.
- Límites de validación en `parseBackup`, en la capa de aplicación del celular.
- La dirección de escucha de la API se extrae a una función pura con su prueba.
- CI en GitHub Actions como puerta antes de publicar.

**Tecnología:** pnpm 9, Node 24, TypeScript strict, Next.js 15.5.x (export estático), NestJS 11, Prisma 6,
Vitest, Jest, Playwright (nuevo, solo como devDependency de `apps/mobile`) y GitHub Actions.

**Diseño:** `docs/diseno/2026-11-07-endurecimiento-seguridad.md`. Se lee junto con este plan.

## Restricciones globales

- **TDD:** cada comportamiento con su prueba, ejecutada y vista en rojo antes del código.
- **Ramas:** una rama y un worktree por etapa, en `../finanzas-wt-<etapa>`, fuera del repo.
  Nunca se trabaja en `main`.
- **Commits:** Conventional Commits en español.
- **Windows:**
  - Nunca escribir archivos con PowerShell 5.1.
  - Conservar CRLF y ASCII en los `.cmd`.
- **Worktree nuevo:** antes de las pruebas de la API, ejecutar `pnpm install`,
  `pnpm --filter @finanzas/domain build` y `pnpm --filter @finanzas/api exec prisma generate`.
  Luego copiar `.env` y `apps/api/.env` desde el repo principal (están ignorados).
- **Base de datos:** Postgres embebido en el puerto 54329 (`pnpm db:start` en el repo principal).
- **Versiones:** solo parches de la misma familia (sin Next 16 ni versiones mayores nuevas). Si un aviso
  crítico o alto exige una mayor, se **para** y se consulta al dueño.
- **Repo público:** nada de secretos ni datos personales.
- **Verificación final de cada etapa:** `pnpm -r --workspace-concurrency=1 test` en verde, revisando cada
  paquete (domain 57, ui 56, api 99, mobile 122 y web 50 al empezar; los números solo pueden subir).
  Además, el typecheck de cada paquete tocado.

## Puntos a vigilar en la revisión

1. **Copias de seguridad existentes.** Una copia exportada hoy, con ids UUID y con ids de ejemplo
   `demo-…` (`SAMPLE_PREFIX = 'demo-'`), debe seguir importándose. Lo cubre la prueba C1-a.
2. **Dirección real con `basePath`.** La CSP no debe bloquear nada bajo `/finanzas/`, ni el service
   worker ni el manifest. Lo cubre la prueba C2 (Playwright, con `NEXT_PUBLIC_BASE_PATH=/finanzas`).
3. **Modo sin conexión.** Tras la CSP, la app recargada sin red debe abrir. Lo cubre C2.
4. **`localhost` contra `127.0.0.1` en Windows.** Node puede resolver `localhost` a `::1`. La web
   (servidor Next) debe seguir llegando a la API y el navegador debe abrir `http://localhost:3000`.
   Lo cubre la verificación manual B1-paso 6.
5. **Montos en el límite.** Exactamente `9223372036854775807` y `-9223372036854775808` se aceptan, y un
   dígito más se rechaza. Lo cubre la prueba C1-c.

---

## Etapa A — `chore/parches-dependencias`

### Tarea A1: parches de dependencias

**Archivos:**
- Modificar:
  - `apps/web/package.json`
  - `apps/mobile/package.json`
  - `packages/ui/package.json`
  - cualquier otro `package.json` que fije `next` 15.5.4
  - `package.json` raíz (`pnpm.overrides`)
  - `pnpm-lock.yaml`

**Interfaces:** ninguna. Ninguna API de código cambia.

- [ ] **Paso 1: Medir el estado actual (rojo).**
  - Ejecutar: `pnpm audit --prod --audit-level high`
  - Esperado: sale con código ≠ 0 y lista los avisos de `next`, `multer`, `sharp`, `postcss` y
    `deepmerge-ts`.
  - Guardar el resumen (cantidad por severidad) para el informe.
- [ ] **Paso 2: Ver las versiones disponibles.**
  - `pnpm view next@15.5 version`: tomar el último 15.5.x.
  - Para cada aviso, revisar `pnpm audit --prod --json` → `patched_versions`.
- [ ] **Paso 3: Subir las dependencias directas.**
  - `next` al último 15.5.x en todos los `package.json` que lo fijen. Mantener la versión exacta, sin `^`,
    como hoy.
  - `react` y `react-dom` al parche 19.1.x, solo si algún aviso lo pide.
- [ ] **Paso 4: Corregir las dependencias indirectas.**
  - Agregar `pnpm.overrides` en el `package.json` raíz con la versión corregida más cercana de cada una
    (por ejemplo `"multer": "^2.5.0"`, `"postcss": "^8.5.23"`; usar las que diga el audit).
  - Ejecutar `pnpm install`.
- [ ] **Paso 5: Verificar (verde).**
  - `pnpm audit --prod --audit-level high`: código 0. Listar en el informe los moderados y bajos que
    queden.
  - `pnpm -r --workspace-concurrency=1 test`: todo en verde.
  - `pnpm --filter @finanzas/web build` y `NEXT_PUBLIC_BASE_PATH=/finanzas pnpm --filter @finanzas/mobile build`:
    los dos compilan.
  - `pnpm -r typecheck`, o `tsc --noEmit` en api y web: código 0.
- [ ] **Paso 6: Commit.**
  ```bash
  git add package.json pnpm-lock.yaml apps/*/package.json packages/*/package.json
  git commit -m "chore: parches de seguridad de next y dependencias indirectas"
  ```

---

## Etapa B — `fix/solo-local` (en paralelo con C, después de A)

### Tarea B1: la versión de computador escucha solo en 127.0.0.1

**Archivos:**
- Crear: `apps/api/src/listen-host.ts`
- Prueba: `apps/api/src/listen-host.spec.ts`, junto a los demás `*.spec.ts` de Jest en `src`.
- Modificar:
  - `apps/api/src/main.ts:11`
  - `apps/web/package.json`: scripts `dev` y `start`
  - `apps/mobile/package.json`: script `dev`
  - `.env.example`: añadir `API_HOST=127.0.0.1` y cambiar `NEXT_PUBLIC_API_URL` a
    `http://127.0.0.1:3001`
  - `apps/web/src/lib/api-client.ts:118`: el valor por defecto pasa a `http://127.0.0.1:3001`

**Interfaces:**
- Produce: `resolveListenHost(env: NodeJS.ProcessEnv): string`

- [ ] **Paso 1: Prueba que falla.** `listen-host.spec.ts`:
  - `resolveListenHost({})` → `'127.0.0.1'`
  - `resolveListenHost({ API_HOST: '' })` → `'127.0.0.1'`
  - `resolveListenHost({ API_HOST: '  ' })` → `'127.0.0.1'`
  - `resolveListenHost({ API_HOST: '0.0.0.0' })` → `'0.0.0.0'`
- [ ] **Paso 2: Ejecutar y verla fallar.**
  - `pnpm --filter @finanzas/api test -- listen-host`
  - Esperado: FAIL, porque el módulo no existe.
- [ ] **Paso 3: Implementar `resolveListenHost`.**
  - Devuelve el valor recortado de `API_HOST`, o `'127.0.0.1'` si viene vacío.
  - En `main.ts`: `await app.listen(port, resolveListenHost(process.env))`. El mensaje de consola debe
    mostrar el host real.
- [ ] **Paso 4: Ejecutar y verla pasar.** El mismo comando. Esperado: PASS.
- [ ] **Paso 5: Scripts de Next.**
  - web: `next dev -p 3000 -H 127.0.0.1` y `next start -p 3000 -H 127.0.0.1`
  - mobile: `next dev -p 3100 -H 127.0.0.1`
  - Actualizar `.env.example` y el valor por defecto de `api-client.ts` como se indica en Archivos.
- [ ] **Paso 6: Verificación manual en Windows.**
  1. Con la BD encendida, ejecutar `pnpm dev` en el worktree.
  2. `netstat -ano | grep -E ":(3000|3001) .*LISTENING"` solo muestra `127.0.0.1`.
  3. `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/` → `200`, y la página trae datos de
     la API (el patrimonio aparece en el HTML).
  4. `curl http://127.0.0.1:3001/summary` responde JSON.
  5. Pegar las salidas en el informe.
  6. Apagar con Ctrl+C.
- [ ] **Paso 7: Commit.**
  ```bash
  git add apps/api/src/listen-host.ts apps/api/src/listen-host.spec.ts apps/api/src/main.ts apps/web/package.json apps/mobile/package.json apps/web/src/lib/api-client.ts .env.example
  git commit -m "fix: la versión de computador solo acepta conexiones locales"
  ```

> **Nota:** después de unir B, cambiar en el `.env` local (no versionado)
> `NEXT_PUBLIC_API_URL` a `http://127.0.0.1:3001` y añadir `API_HOST=127.0.0.1`.

---

## Etapa C — `feat/escudo-movil` (en paralelo con B, después de A)

### Tarea C1: límites al importar la copia de seguridad

**Archivos:**
- Modificar:
  - `apps/mobile/src/application/backup.ts`
  - `apps/mobile/src/features/SettingsScreen.tsx`: líneas 21-29 (`readText`) y el manejo del archivo
    elegido
- Prueba: `apps/mobile/src/application/backup.test.ts`. Ampliarla con un `describe('límites')`.

**Interfaces:**
- Produce, exportadas desde `backup.ts`:
  - `MAX_BACKUP_BYTES = 10 * 1024 * 1024`
  - `MAX_ITEMS = { accounts: 500, transactions: 200_000, scheduledExpenses: 2_000 }`
  - `MAX_TEXT = { id: 100, name: 80, description: 160, category: 60 }` (los mismos límites que los
    formularios de `@finanzas/ui` y los DTO de la API)
  - `checkBackupFileSize(size: number): string | null`: devuelve el mensaje de error, o `null` si el
    tamaño está bien.
  - Mensaje de archivo grande, texto exacto: `'El archivo es demasiado grande para ser una copia de Mis Finanzas (máximo 10 MB).'`
  - Mensaje de demasiados elementos, texto exacto: `'La copia tiene más datos de los que la app puede manejar, así que no se puede usar.'`
  - Los textos demasiado largos, los ids con caracteres no permitidos y los montos fuera de rango devuelven
    el mensaje existente `DAMAGED`.

- [ ] **Paso 1: Pruebas que fallan.**
  - **(a) Compatibilidad hacia atrás:** `serializeBackup` de un snapshot que mezcla datos de ejemplo
    (ids `demo-…`, de `sample-data.ts`) y datos propios (ids de `crypto.randomUUID()`), pasado por
    `parseBackup`, da `ok: true` con los mismos totales. Además, un JSON literal de versión 1 escrito a
    mano en la prueba, con la forma de hoy, da `ok: true`.
  - **(b) Tamaño del archivo:**
    - `checkBackupFileSize(MAX_BACKUP_BYTES + 1)` → el mensaje de archivo grande.
    - `checkBackupFileSize(MAX_BACKUP_BYTES)` → `null`.
  - **(c) Montos:**
    - `"9223372036854775807"` y `"-9223372036854775808"` → `ok: true`.
    - `"9223372036854775808"` y `"-9223372036854775809"` → `ok: false`, con `DAMAGED`.
  - **(d) Textos:**
    - Un `description` de 161 caracteres, un `name` de 81 y un `category` de 61 → `DAMAGED`.
    - Los de 160, 80 y 60 → `ok: true`.
  - **(e) Ids:**
    - Un id con `<script>`, uno vacío y uno de 101 caracteres → `DAMAGED`.
    - Los ids `demo-efectivo` y `3f2b8c1e-0000-4000-8000-000000000000` → aceptados.
  - **(f) Cantidad:** con `MAX_ITEMS.accounts + 1` cuentas → el mensaje de demasiados elementos. Para que
    la prueba sea rápida, construir objetos mínimos.
  - **(g) Pantalla:** en la prueba existente de la pantalla de ajustes (o una nueva junto a
    `SettingsScreen`), elegir un `File` de más de 10 MB muestra el mensaje de archivo grande sin llamar a
    `parseBackup`. Se puede simular `size` con `Object.defineProperty`.
- [ ] **Paso 2: Ejecutar y verlas fallar.**
  - `pnpm --filter @finanzas/mobile test -- backup`
  - Esperado: FAIL en (b) a (g). (a) puede pasar desde el inicio: es una prueba de protección y se deja
    así.
- [ ] **Paso 3: Implementar.**
  - **Ids:** se validan con `/^[A-Za-z0-9_-]{1,100}$/`, compatible con UUID y con `demo-…`.
  - **Montos:** se valida el rango de int64 sobre el `BigInt` antes de `Money.of`.
  - **Textos:** se validan con los largos de `MAX_TEXT`.
  - **Cantidad:** el tope se revisa sobre los arreglos crudos, antes de mapearlos.
  - **Pantalla:** `SettingsScreen` llama a `checkBackupFileSize(file.size)` antes de `readText`.
- [ ] **Paso 4: Ejecutar y verlas pasar.**
  - `pnpm --filter @finanzas/mobile test`: todo en verde, incluidas las 122 pruebas previas.
  - `pnpm --filter @finanzas/mobile typecheck`: en verde.
- [ ] **Paso 5: Commit.**
  ```bash
  git commit -am "feat(mobile): límites de tamaño, cantidad y rango al importar la copia de seguridad"
  ```

### Tarea C2: CSP en la PWA, comprobada en navegador

**Archivos:**
- Crear: `apps/mobile/src/pwa/csp.ts`
- Prueba unitaria: `apps/mobile/src/pwa/csp.test.ts`
- Modificar: `apps/mobile/src/app/layout.tsx` (`<head>`)
- Crear:
  - `apps/mobile/e2e/csp-offline.spec.ts`
  - `apps/mobile/playwright.config.ts`
  - script `e2e` en `apps/mobile/package.json`
  - devDependency `@playwright/test`
- Si `vitest.config` de mobile incluye `e2e/`, excluir esa carpeta allí.

**Interfaces:**
- Produce: `CONTENT_SECURITY_POLICY: string`, exportada desde `csp.ts`. El `layout` la usa en
  `<meta httpEquiv="Content-Security-Policy" content={CONTENT_SECURITY_POLICY} />`.

- [ ] **Paso 1: Prueba unitaria que falla.** `csp.test.ts` comprueba que la política:
  - contiene `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`,
    `connect-src 'self'`, `img-src 'self' data:`, `worker-src 'self'` y `manifest-src 'self'`;
  - **no** contiene `'unsafe-eval'`;
  - **no** contiene `*` como origen.
- [ ] **Paso 2: Ejecutar y verla fallar.**
  - `pnpm --filter @finanzas/mobile test -- csp`
  - Esperado: FAIL, porque el módulo no existe.
- [ ] **Paso 3: Prueba e2e que falla.** `csp-offline.spec.ts`. `webServer` en `playwright.config.ts`:
  1. compila con `NEXT_PUBLIC_BASE_PATH=/finanzas`;
  2. sirve `out/` bajo `/finanzas/`, con un servidor estático pequeño en Node dentro de
     `apps/mobile/e2e/serve.mjs`, sin dependencias nuevas aparte de Playwright;
  3. usa un puerto libre, por ejemplo 4173.

  Casos:
  - **Sin violaciones:** abrir `/finanzas/` y escuchar `page.on('console')` y el evento
    `securitypolicyviolation` (se agrega con `page.addInitScript`). Se esperan 0 violaciones de CSP y que
    se vea el título "Mis Finanzas".
  - **Sin conexión:**
    1. Esperar a que el service worker quede activo (`navigator.serviceWorker.ready`).
    2. `context.setOffline(true)` y recargar.
    3. La página vuelve a mostrar la pantalla principal.
  - **Primera ejecución:** el caso de violaciones debe **fallar** con la CSP ausente si la prueba busca
    el `<meta>`. Añadir esa aserción: `meta[http-equiv="Content-Security-Policy"]` existe.
- [ ] **Paso 4: Ejecutar y verla fallar.**
  - Ejecutar `pnpm --filter @finanzas/mobile exec playwright install chromium` (instala en la carpeta del
    usuario, sin admin).
  - Luego `pnpm --filter @finanzas/mobile e2e`.
  - Esperado: FAIL, porque no existe el `<meta>`.
- [ ] **Paso 5: Implementar.**
  - Definir `CONTENT_SECURITY_POLICY` e insertarla en el `<head>` del layout como primer elemento.
  - Para `script-src` y `style-src`, partir de `'self'` y mirar qué bloquea el navegador en el Paso 6.
  - Next inyecta scripts en línea en el export estático. Si no se pueden fijar hashes estables en el
    build, se acepta `script-src 'self' 'unsafe-inline'` y `style-src 'self' 'unsafe-inline'`, dejando un
    comentario que explique por qué (el `<meta>` no admite nonces en un sitio estático).
  - Nunca se usa `'unsafe-eval'`.
- [ ] **Paso 6: Ejecutar y verlas pasar.**
  - `pnpm --filter @finanzas/mobile test` y `pnpm --filter @finanzas/mobile e2e`: en verde.
  - Pegar la política final y la salida en el informe.
- [ ] **Paso 7: Commit.**
  ```bash
  git add apps/mobile pnpm-lock.yaml
  git commit -m "feat(mobile): política de seguridad de contenido (CSP) con prueba en navegador y sin conexión"
  ```

> **Después de unir C y publicar:** se abre la dirección real
> `https://juanmartinmesaquintero8-arch.github.io/finanzas/` y revisa la consola, sin violaciones de CSP.

---

## Etapa D — `chore/ci-seguridad` (después de A, B y C)

### Tarea D1: CI como puerta antes de publicar

**Archivos:**
- Crear: `.github/workflows/ci.yml`
- Modificar: `.github/workflows/deploy-mobile.yml`

**Interfaces:**
- Produce: el workflow reutilizable `ci.yml`, con `on: [push, pull_request, workflow_call]` y un job `checks`.
- `deploy-mobile.yml` lo llama con `uses: ./.github/workflows/ci.yml`, y su `build` declara `needs: ci`.

- [ ] **Paso 1: Escribir `ci.yml`** con un job `checks` (`ubuntu-latest`, `permissions: contents: read`):
  1. checkout;
  2. pnpm 9.15.4;
  3. Node desde `.nvmrc`;
  4. `pnpm install --frozen-lockfile`;
  5. `pnpm --filter @finanzas/domain build`;
  6. `pnpm --filter @finanzas/api exec prisma generate`;
  7. typecheck de ui, mobile, api y web;
  8. `pnpm audit --prod --audit-level high`;
  9. pruebas. La API usa un `services: postgres:16` con usuario y clave `postgres` y la BD
     `finanzas_test`. Se pasa `TEST_DATABASE_URL`, que ya lee `apps/api/test/global-setup.ts`, y se
     ejecuta `prisma migrate deploy` antes de las pruebas. Si el setup de pruebas exige el embebido,
     ajustar solo la configuración de CI, no el código.
- [ ] **Paso 2: Modificar `deploy-mobile.yml`.**
  - El nivel superior queda con `permissions: contents: read`.
  - `pages: write` e `id-token: write` pasan solo al job `deploy`.
  - Se agrega el job `ci`, que llama a `ci.yml`, y `build` declara `needs: ci`.
- [ ] **Paso 3: Fijar las acciones por SHA.** Cada `uses: owner/action@vN` se reemplaza por el SHA del tag
  (`gh api repos/<owner>/<action>/git/ref/tags/<tag>`), con el comentario `# vN`.
- [ ] **Paso 4: Validar el YAML.**
  - Si `actionlint` se puede descargar como binario a la carpeta del usuario, ejecutarlo. Esperado: sin
    errores.
  - Si no, revisar la sintaxis a mano y decirlo.
- [ ] **Paso 5: Probar en GitHub.** Requiere el repo público con Pages activo; si no lo está, avisar al
  dueño y parar aquí.
  1. Subir la rama: `git push -u origin chore/ci-seguridad`.
  2. `gh run watch`: `ci.yml` en verde.
  3. **Prueba de bloqueo:** crear la rama desechable `test/ci-bloquea` con una prueba que falla a propósito
     en `packages/domain`. Ejecutar `gh workflow run deploy-mobile.yml --ref test/ci-bloquea`, comprobar
     que `deploy` queda saltado o fallido porque falló `ci`, y borrar la rama local y la remota.
  4. Pegar los enlaces o los resúmenes de las ejecuciones.
- [ ] **Paso 6: Commit.**
  ```bash
  git add .github/workflows
  git commit -m "ci: pruebas, typecheck y auditoría de dependencias antes de publicar; permisos mínimos"
  ```

---

## Integración (después de cada etapa)

1. Correr todas las pruebas en el worktree de la etapa.
2. Hacer revisión de código sobre `git diff main...<rama>`.
3. Corregir los hallazgos críticos e importantes con TDD y volver a revisar.
4. `git merge --no-ff` a `main`. Volver a correr todas las pruebas en `main`.
5. `git push origin main`. Requiere que el dueño haya hecho público el repo; si no, se deja en local.
6. Borrar el worktree y la rama.
