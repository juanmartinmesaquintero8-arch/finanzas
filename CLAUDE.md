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

Para **cada módulo**:
1. Analizar la arquitectura y el impacto.
2. Delegar la lógica al agente especializado apropiado (`typescript-pro`, `nextjs-expert`, `database-expert`, `test-generator`, …) o implementarla directamente.
3. Escribir/verificar las pruebas (TDD).
4. **Auditoría**: ejecutar los tests en consola y revisar el código.
5. Refactorizar si es necesario. Solo entonces dar la tarea por terminada.

## 6. Reglas de Git (ESTRICTAS)

- **Prohibido trabajar directamente en `main`.**
- Cada feature nuevo en su rama: `git checkout -b feat/<nombre>` (ej. `feat/db-setup`, `feat/transferencias`).
- Commits pequeños con Conventional Commits (`feat:`, `test:`, `refactor:`, `chore:`, `fix:`).
- Solo se integra a `main` (`git merge --no-ff`) con **todos los tests en verde**.

## 7. Notas de entorno (Windows)

- Si `node`/`pnpm` no aparecen en una shell nueva, refrescar PATH en PowerShell:
  `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`
- `.env` (no versionado) a partir de `.env.example`.
