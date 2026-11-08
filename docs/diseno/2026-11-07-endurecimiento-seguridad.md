# Diseño: endurecimiento de seguridad (auditoría del 2026-11-07)

## 1. Intención y por qué

La auditoría del 2026-11-07 encontró huecos de seguridad. El dueño quiere cerrarlos para que nadie más
pueda ver ni tocar sus finanzas. Además, las reglas del proyecto exigen seguridad desde el diseño:
validar toda entrada, permisos mínimos y protección contra inyecciones y bots.

Contexto que decide el alcance, confirmado por el dueño el 2026-11-07:
- **El dueño usa la app solo en el celular.** La app es `apps/mobile`: una PWA estática que guarda los
  datos en IndexedDB y se publica en GitHub Pages. Allí está el valor; sus riesgos son:
  - un script ajeno que lea IndexedDB;
  - un archivo de copia de seguridad malformado o gigante;
  - las dependencias con avisos conocidos.
- **La versión de computador** (API NestJS + web Next.js + Postgres embebido, que se abre con
  `Abrir Finanzas.cmd` → `pnpm dev`) hoy no se usa. Si algún día se usa, será solo desde ese mismo
  computador. Por eso basta con que no acepte conexiones de otros aparatos. No hace falta usuario ni
  contraseña.
- **La app del celular está fuera de línea desde que el repo pasó a privado.** Pages gratis solo publica
  repos públicos. El último despliegue que funcionó fue el del 2026-10-25, y el del 2026-11-07 falló.
  - El dueño decidió **volver a hacer público el repo** y reactivar Pages. Esto lo hace él con un comando,
    aparte de este trabajo.
  - Antes se revisó que no haya secretos en todo el historial. Solo aparece la clave local de ejemplo
    `postgres` del Postgres embebido.

## 2. Objetivos

1. `pnpm audit --prod` sin avisos **críticos ni altos**.
2. La PWA tiene una política de seguridad de contenido (CSP) y la importación de la copia de seguridad
   tiene límites de tamaño, de cantidad y de rango.
3. Las mejoras llegan al celular: la publicación automática corre las pruebas y la auditoría de
   dependencias antes de publicar, con permisos mínimos.
4. Ningún aparato de la red local puede llegar a la API ni a la web del computador.

## 3. Fuera de alcance (no se hace ahora)

- Autenticación con usuario y contraseña. No hace falta, porque el uso es solo local.
- Endurecer más la API de escritorio: helmet, tope de peticiones, `forbidNonWhitelisted`, rango de montos
  en DTOs y la paginación de `findAll`. Hoy no se usa y la puerta queda cerrada (Etapa B), así que se
  retoma solo si el dueño vuelve a usar la versión de computador.
- Saltar a versiones mayores nuevas (Next 16, etc.). Solo se aplican parches de la misma familia
  (opción elegida por el dueño).
- El benchmark del motor de proyecciones, los scripts de cobertura en api/web/mobile/ui y la optimización
  del ETag. Son hallazgos de rendimiento y calidad que van en otra tanda.

## 4. Lo que sería un fracaso aunque "funcione"

- Que la app instalada en el celular deje de abrir o de funcionar sin internet, o que la CSP rompa el
  service worker o la carga de la página en la dirección real (con `basePath` `/finanzas`).
- **Que una copia de seguridad que el dueño ya tiene guardada no se pueda recuperar.** También que se
  pierdan o cambien datos.
- Que el ícono `Abrir Finanzas` deje de abrir la app en el navegador del mismo computador.
- Que algo requiera permisos de administrador en Windows.

## 5. Restricciones

- Las reglas internas de desarrollo del proyecto:
  - TDD: cada comportamiento con su prueba, vista primero en rojo.
  - Una rama y un worktree por etapa.
  - Todas las pruebas más revisión de código antes de integrar.
  - Dinero en enteros.
- Windows: nunca escribir archivos con PowerShell 5.1 (agrega BOM).
- Las pruebas de integración de la API usan Postgres embebido en el puerto 54329.
- El repo será público: nada de secretos ni datos personales en commits.

## 6. Enfoques considerados

| Enfoque | Qué ofrece | Qué cuesta |
|---|---|---|
| **1. Cerrar la puerta y poner parches** (elegido) | Tapa los hallazgos de seguridad con parches de la misma familia de versiones. | Poco riesgo de romper lo existente. Son 4 etapas cortas. |
| 2. Lo mismo, pero con las versiones más nuevas | Software más moderno. | Más probabilidad de romper cosas y bastante más trabajo, sin ganar seguridad hoy. |
| 3. Solo lo urgente | Lo más rápido. | Deja huecos menores que las reglas piden cerrar. |

El dueño eligió el **1** el 2026-11-07. Cuando después aclaró que solo usa el celular, el trabajo sobre
la API de escritorio se redujo a la Etapa B mínima.

## 7. Qué se hace, por etapas

Cada etapa va en su rama y su worktree, con sus pruebas, y pasa por revisión de código antes de unirse a
`main`.

### Etapa A — Piezas actualizadas (`chore/parches-dependencias`)
- Subir `next` en web, mobile y ui (hoy en 15.5.4, en 4 `package.json`) al último parche 15.5.x que corrija
  los avisos. Hay que comprobar en el registro que exista y qué avisos cierra.
- Subir `react` y `react-dom` al parche 19.1.x que corresponda si algún aviso lo pide.
- Los avisos de dependencias indirectas (`multer`, `postcss`, `deepmerge-ts`, `sharp`, etc.) se corrigen
  con `pnpm.overrides` en el `package.json` raíz. Se elige la versión corregida más cercana a la actual.
- **Si un aviso crítico o alto solo se arregla con un salto de versión mayor:** se para y se le pregunta
  al dueño. Las salidas posibles son una excepción documentada con fecha de vencimiento, el salto solo
  de esa pieza o quitar la dependencia. Es una decisión grande y no la toma el constructor.
- **Se acepta cuando:**
  - `pnpm audit --prod` da 0 críticos y 0 altos (los moderados y bajos que no tengan arreglo quedan
    listados en el informe).
  - Pasan todas las pruebas.
  - `pnpm --filter @finanzas/web build` y `pnpm --filter @finanzas/mobile build` compilan.
  - El typecheck queda en verde.

### Etapa B — Puerta cerrada en el computador (`fix/solo-local`), mínima
- La API escucha en `127.0.0.1` por defecto, configurable con `API_HOST`.
- La web (`next dev` y `next start`) y el modo dev de mobile escuchan con `-H 127.0.0.1`.
- `Abrir Finanzas.cmd` y `scripts/dev.mjs` deben seguir funcionando. Si el `.cmd` revisa el puerto de
  otra forma, se ajusta.
- No toca `packages/domain` ni `apps/mobile/src`.
- **Se acepta cuando:**
  - Una prueba, que primero falló, muestra que la dirección de escucha por defecto de la API es
    `127.0.0.1`.
  - Los scripts de web y mobile tienen `-H 127.0.0.1`.
  - Todas las pruebas están en verde.

### Etapa C — Escudo del celular (`feat/escudo-movil`)
- **CSP** en `apps/mobile/src/app/layout.tsx` con `<meta http-equiv="Content-Security-Policy">`, porque
  GitHub Pages no permite cabeceras propias.
  - Lo más estricto que acepte el export estático de Next: `default-src 'self'`, `connect-src 'self'`,
    `img-src 'self' data:`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`.
  - `script-src` y `style-src` se ajustan a lo que Next necesite en línea; si hace falta, con hashes en
    vez de `'unsafe-inline'`, cuando sea viable.
  - Debe funcionar con `basePath` y con el service worker.
- **Copia de seguridad** (`apps/mobile/src/application/backup.ts`, `parseBackup` y la lectura del archivo
  en la UI):
  - Tamaño máximo del archivo de 10 MB, rechazado antes de leerlo.
  - Tope de elementos por colección.
  - Montos dentro del rango de un entero de 64 bits.
  - Largo máximo de los textos.
  - Validación de ids (decisión de implementación):
    - Deben aceptarse **todos los formatos que la app ha generado**: UUID (`crypto.randomUUID()`) y los
      ids `sample-…` de los datos de ejemplo (`sample-data.ts`).
    - Se valida con largo máximo y un conjunto de caracteres seguro, no con un patrón UUID estricto.
  - Mensajes claros en español.
- **Compatibilidad hacia atrás:** una prueba con una copia exportada en el formato actual de versión
  (con datos propios y de ejemplo) debe seguir importándose sin errores.
- **Se acepta cuando:**
  - Hay pruebas unitarias de cada límite y de la compatibilidad hacia atrás.
  - La app compilada con `NEXT_PUBLIC_BASE_PATH=/finanzas` y servida en local bajo `/finanzas/` abre,
    funciona sin conexión y no muestra violaciones de CSP en la consola, comprobado con Playwright.
  - Todas las pruebas en verde.
  - Tras publicar, se comprueba lo mismo en la dirección real.

### Etapa D — Publicación con control (`chore/ci-seguridad`)
- Un flujo de integración continua en cada push y PR:
  - instalar con `--frozen-lockfile`;
  - typecheck;
  - pruebas de domain, ui, mobile y web;
  - pruebas de la API, con la base de datos que sea viable en CI (un servicio Postgres de GitHub
    Actions o el embebido);
  - `pnpm audit --prod --audit-level high`.
- El workflow de publicación del celular solo publica si pasa ese control.
- **Si mañana aparece un aviso alto nuevo en una pieza de terceros**, la publicación se bloquea hasta
  arreglarlo (decisión de implementación: seguridad primero). Una excepción temporal solo se agrega con OK
  del dueño, documentada y con fecha de vencimiento.
- Los permisos `pages: write` e `id-token: write` pasan al job `deploy`; `build` queda con
  `contents: read`.
- Las acciones de terceros se fijan por SHA, con un comentario que indique la versión.
- **Se acepta cuando:**
  - El YAML es válido (`actionlint`, si se puede instalar sin admin).
  - El flujo corre en verde en GitHub.
  - Queda demostrado que una prueba fallida bloquea la publicación, en una rama de prueba que no se une.

## 8. Orden, subidas y paralelismo

1. **A** va primero, porque cambia el lockfile y las demás dependen de las piezas nuevas.
2. **B y C** pueden ir en paralelo cuando A esté en `main`. B no toca `packages/domain` ni el código del
   celular, y ninguna de las dos agrega dependencias. Si alguna necesitara una, van en secuencia.
3. **D** va al final, porque su auditoría de dependencias necesita A ya integrado.
4. **Subidas a GitHub** (decisión de implementación):
   - `main` se sube tras unir cada etapa, porque cada unión ya pasó todas las pruebas y la revisión en
     local. Así las mejoras llegan al celular cuanto antes.
   - Las ramas solo se suben cuando hace falta verlas correr en GitHub (Etapa D).
   - El repo debe estar ya público y con Pages activo; si no, la publicación falla sin causar daño.

## 9. Lo que queda a criterio del constructor

- Los números exactos del tope de elementos por colección en la copia de seguridad.
- Si la API de CI usa un servicio Postgres o el embebido.
- La forma exacta de la CSP compatible con Next.
- Las versiones exactas de los parches, siempre dentro de la misma familia y con 0 críticos y 0 altos.
