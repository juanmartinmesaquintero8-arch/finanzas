# Parches de dependencias (overrides)

Algunas librerías vienen "escondidas" dentro de otras. Cuando la librería de afuera todavía no trae la
versión corregida, se fuerza con `pnpm.overrides` en el `package.json` raíz.

**Fecha de revisión de todos los overrides: 2027-02-07.**

| Override | Avisos que cierra | Paquete padre que lo trae | Cuándo quitarlo |
|---|---|---|---|
| `multer ^2.5.0` | GHSA-q7qp-rjg7-q26m | `@nestjs/platform-express` (API) | Cuando NestJS 11 publique una versión que traiga multer >= 2.5.0 |
| `postcss ^8.5.23` | GHSA-qx2v-qp2m-jg93, GHSA-6g55-p6wh-862q, GHSA-r28c-9q8g-f849, GHSA-fxqj-rqcc-2cmp | `next` (trae 8.4.31) | Cuando Next 15.5.x traiga postcss >= 8.5.23 |
| `sharp ^0.35.5` | GHSA-f88m-g3jw-g9cj, GHSA-rgj7-g3m4-5g8c, GHSA-wq5f-xc86-pv6w | `next` y `apps/mobile` (íconos) | Cuando Next traiga sharp >= 0.35.5 |
| `deepmerge-ts ^8.0.2` | GHSA-ggr8-5vv4-36mx | `prisma` > `@prisma/config` (Prisma 6.19) | Cuando Prisma publique una versión que use deepmerge-ts >= 8 |

## Excepciones aprobadas por el dueño (2026-11-07)

`deepmerge-ts` 7 -> 8 y `sharp` 0.34 -> 0.35 saltan de versión más allá de la "misma familia". Se aceptaron
de forma explícita porque es la única forma de cerrar avisos altos. Comprobado con: pruebas de la API,
`prisma validate`, `prisma migrate status`, build de web y mobile y `pnpm --filter @finanzas/mobile icons`
(los íconos salen idénticos).

## Avisos conocidos fuera de alcance

`pnpm audit --prod --audit-level high` termina en 0. La auditoría completa aún lista avisos solo de
herramientas de desarrollo (no se publican): `vitest` 3.2.4, `tinypool`, `@vitest/mocker`, `glob`,
`minimatch` (vía `@vitest/coverage-v8`) y `deepmerge` (vía `jest` 29). Arreglarlos exige subir vitest o jest
de versión mayor; se revisan en la fecha indicada.
