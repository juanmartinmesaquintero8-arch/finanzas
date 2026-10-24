# CLAUDE.md — Finanzas Personales

Manual y reglas del proyecto. **Léelo al inicio de cada sesión y respétalo siempre.**

## 1. Producto (MVP)

Sistema de control de finanzas personales.

1. **Transacciones**: registrar ingresos, gastos y transferencias entre cuentas.
2. **Cuentas múltiples**: el saldo se refleja dividido por cuenta (ej. Efectivo, Bancolombia, Nu).
3. **Patrimonio total**: suma de los saldos de todas las cuentas.
4. **Gastos Programados + motor de proyecciones**: compromisos futuros (únicos o recurrentes)
   que se restan para calcular el **Saldo Real Disponible** a una fecha de corte.
   `Saldo Real Disponible = Patrimonio total − Σ ocurrencias de gastos programados pendientes hasta la fecha de corte`
5. **UI mobile-first** basada en tarjetas/chips, con **historial detallado** de movimientos.

## 2. Stack tecnológico

| Capa | Tecnología |
|---|---|
| Lenguaje | TypeScript (strict). Go queda reservado para servicios futuros de alto rendimiento; el MVP es 100 % TS. |
| Monorepo | pnpm workspaces (`apps/*`, `packages/*`) |
| Dominio | `packages/domain` — TypeScript puro, sin dependencias de framework |
| API | `apps/api` — NestJS + Prisma |
| Web | `apps/web` — Next.js (App Router) + CSS Modules, mobile-first |
| Base de datos | PostgreSQL. En desarrollo: `embedded-postgres` (`pnpm db:start`), sin Docker ni admin. Cualquier Postgres real sirve cambiando `DATABASE_URL`. |
| Tests | Vitest (`domain`, `web`), Jest (`api`, estándar de NestJS) |

Entorno: Node 24 LTS, pnpm 9. Ubicación: `C:\Users\juanm\dev\finanzas` (fuera de OneDrive a propósito: OneDrive rompe `node_modules` y no permitía crear carpetas).

### 2.1 App móvil local-first (decisión del 2026-10-24)

El usuario (Android) quiere la app **solo en su celular, con los datos únicamente en el dispositivo**:
- `apps/mobile`: Next.js con `output: 'export'` (estático) + **PWA** instalable y offline (manifest + service worker).
- Persistencia en **IndexedDB** del navegador mediante repositorios que implementan los puertos de `packages/domain`. Ningún dato financiero sale del teléfono.
- **Copia de seguridad**: exportar/importar un archivo JSON versionado (compartir vía Web Share API a WhatsApp/Drive/correo).
- Publicación de la "caja" estática en **GitHub Pages** (HTTPS, gratis) vía GitHub Actions. GitHub nunca recibe datos del usuario.
- UI compartida con `apps/web` a través de `packages/ui` (componentes presentacionales y helpers puros). Sin duplicar.
- `apps/api` + PostgreSQL se mantienen para la versión de escritorio y una futura sincronización opcional.

## 3. Arquitectura

Arquitectura hexagonal (puertos y adaptadores) + DDD ligero.

```
packages/domain      ← núcleo: entidades, value objects, servicios de dominio, puertos (interfaces)
apps/api             ← casos de uso (application) + adaptadores (Prisma repos, controllers HTTP)
apps/web             ← cliente; consume la API, nunca contiene reglas de negocio
```

Reglas:
- **El dominio no importa nada** de NestJS, Prisma, Next ni Node APIs de I/O.
- **Dinero**: siempre en unidades mínimas enteras (`bigint` en BD, value object `Money` en dominio). Nunca `float`.
- **El saldo de una cuenta se deriva** de saldo inicial + transacciones (ledger). No se guarda un saldo mutable.
- **Transferencia** = un único movimiento con cuenta origen y destino; no altera el patrimonio total.
- Repositorios definidos como **puertos** en el dominio; implementaciones Prisma en `apps/api/src/infrastructure`.
- Validación de entrada en los bordes (DTOs con `class-validator`); invariantes en las entidades.

### Patrones y principios obligatorios
- **SOLID** en todo el código. Una clase = una responsabilidad.
- **Repository** (persistencia), **Strategy** (reglas de recurrencia de gastos programados),
  **Factory** (creación de transacciones por tipo), **Value Object** (`Money`, ids), inyección de dependencias (Nest).
- Funciones puras para cálculos (saldos, patrimonio, proyecciones).
- Nombres en inglés en el código; textos de UI y documentación en español.

## 4. Metodología TDD (OBLIGATORIA)

Ciclo **Red → Green → Refactor** para cada unidad de comportamiento:
1. Escribir el test primero.
2. **Ejecutarlo en la terminal y verlo fallar** (Red).
3. Escribir el código mínimo para pasarlo y ejecutarlo (Green).
4. Refactorizar con los tests en verde.

No se escribe código de producción sin un test que lo exija. Cobertura objetivo del dominio ≥ 90 %.

Comandos:
```
pnpm test                      # todos los workspaces
pnpm --filter @finanzas/domain test
pnpm --filter @finanzas/api test
pnpm --filter @finanzas/web test
pnpm db:start                  # Postgres embebido (puerto 54329)
```

## 5. Rol del orquestador (Claude)

> **Comunicación con el usuario:** el usuario NO es técnico. Toda explicación, pregunta, plan o reporte
> debe darse en lenguaje simple ("para dummies"): analogías cotidianas, sin jerga (o explicándola en una frase),
> y siempre diciendo primero qué significa para él en la práctica. Los detalles técnicos solo si los pide.

Para **cada módulo**:
1. Analizar la arquitectura y el impacto.
2. Delegar la lógica al agente especializado apropiado (`typescript-pro`, `nextjs-expert`, `database-expert`, `test-generator`, …) o implementarla directamente.
3. Escribir/verificar las pruebas (TDD).
4. **Auditoría**: ejecutar los tests en consola, revisar el código y verificar las reglas de rendimiento y caché (sección 7).
5. Refactorizar si es necesario. Solo entonces dar la tarea por terminada.

## 6. Reglas de Git (ESTRICTAS)

- **Prohibido trabajar directamente en `main`.**
- Cada feature nuevo en su rama: `git checkout -b feat/<nombre>` (ej. `feat/db-setup`, `feat/transferencias`).
- Commits pequeños con Conventional Commits (`feat:`, `test:`, `refactor:`, `chore:`, `fix:`).
- Solo se integra a `main` (`git merge --no-ff`) con **todos los tests en verde**.

## 7. Performance, rendimiento y caché (OBLIGATORIO)

Principio: **medir antes de optimizar**, pero diseñar desde el inicio para que el ledger escale.
Toda optimización llega con un test (o benchmark) que la respalde.

### 7.1 Presupuestos (SLO)
| Métrica | Objetivo |
|---|---|
| API `GET /summary` / proyección (p95) | < 150 ms |
| API listados paginados (p95) | < 100 ms |
| Web móvil (Lighthouse, 4G lenta) | Performance ≥ 90 · LCP < 2,5 s · INP < 200 ms · CLS < 0,1 |
| JS inicial por ruta | < 150 kB gzip |
| Motor de proyecciones (dominio) | 1 000 gastos programados × 12 meses < 50 ms (`vitest bench`) |

### 7.2 Base de datos
- **Saldos por agregación SQL** (`SUM … GROUP BY account`) en el repositorio, nunca cargando todo el ledger en memoria; el dominio recibe los totales.
- **Índices obligatorios**: `transactions(account_id, date)`, `transactions(from_account_id)`, `transactions(to_account_id)`, `transactions(date DESC, id)`, `scheduled_expenses(account_id)`.
- **Historial con paginación por cursor (keyset)** sobre `(date, id)`; prohibido `OFFSET` en listados que crecen.
- Evitar N+1: `select`/`include` explícitos en Prisma; nunca consultas dentro de bucles.
- Escrituras que tocan varias filas (ej. transferencia, liquidar gasto programado) dentro de **una transacción de BD**.
- Revisar con `EXPLAIN ANALYZE` toda consulta nueva de agregación. Si el ledger supera ~100 k filas por usuario: snapshots mensuales de saldo (tabla materializada) + delta desde el último snapshot.
- Pool de conexiones configurado vía `DATABASE_URL` (`connection_limit`).

### 7.3 Caché
- **Puerto `CachePort`** en la capa de aplicación (DIP). Implementación en memoria (LRU) en desarrollo; Redis en producción, sin tocar casos de uso.
- Cachear lecturas costosas: resumen (patrimonio + saldos por cuenta) y proyecciones por `(from, to)`.
- **Invalidación por eventos** (patrón Observer / domain events): crear/editar/borrar transacciones, cuentas o gastos programados invalida las claves afectadas. TTL corto (≤ 60 s) solo como red de seguridad, nunca como mecanismo principal.
- Claves versionadas y con namespace: `summary:v1:<userId>`, `projection:v1:<userId>:<from>:<to>`.
- HTTP: los datos financieros son privados → `Cache-Control: private, no-cache` + **ETag** para revalidación (304). Nunca caché compartida/CDN para datos de usuario.
- Web (Next.js): Server Components con `fetch` etiquetado (`next: { tags }`) y `revalidateTag` tras cada mutación; estáticos con caché inmutable (hash en el nombre).
- Toda caché debe tener test de **invalidación** (que un dato nuevo se vea tras escribir).

### 7.4 Frontend
- Mobile-first: CSS Modules sin librerías de UI pesadas; `next/font` y `next/image`.
- Server Components por defecto; `"use client"` solo donde hay interacción.
- Actualizaciones optimistas en el registro de transacciones; historial con scroll infinito por cursor y virtualización si la lista supera ~200 elementos.
- Carga diferida (`dynamic()`) de vistas secundarias (gráficas, formularios avanzados).

### 7.5 Cálculo en el dominio
- Funciones puras O(n) sobre el ledger; el motor de proyecciones limita el horizonte (máx. 24 meses) para acotar ocurrencias.
- `bigint` para dinero: correcto y suficientemente rápido; no optimizar con `number`.
- Benchmarks en `packages/domain/src/**/*.bench.ts`; una regresión > 20 % se trata como bug.

### 7.6 Agentes de apoyo
Para auditorías de rendimiento delegar en `performance-engineer` (opus), carga en `load-tester`, consultas en `database-expert` y web en `mobile-optimizer`.

## 8. Notas de entorno (Windows)

- Si `node`/`pnpm` no aparecen en una shell nueva, refrescar PATH en PowerShell:
  `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`
- `.env` (no versionado) a partir de `.env.example`.
- **Nunca escribir archivos con PowerShell 5.1** (`Set-Content`, `Out-File`, `ConvertTo-Json`): agregan BOM y rompen `package.json` (Vitest/PostCSS fallan). Usar la herramienta Write/Edit.
- Antes de cada merge a `main`, correr `pnpm -r --workspace-concurrency=1 test` y revisar el resultado **de cada paquete**, no solo la última línea.
- BD en UTF8 obligatoria. `pnpm db:start` avisa si no lo está; `pnpm db:start --reset-encoding` la recrea (borra datos). `pnpm db:seed` carga datos de ejemplo.
