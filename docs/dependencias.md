# Parches de dependencias (overrides)

Algunas librerias vienen "escondidas" dentro de otras. Cuando la libreria de afuera todavia no trae la
version corregida, se fuerza con `pnpm.overrides` en el `package.json` raiz.

**Fecha de revision de todos los overrides: 2027-02-07.**

| Override | Avisos que cierra | Paquete padre que lo trae | Cuando quitarlo |
|---|---|---|---|
| `multer ^2.5.0` | GHSA-q7qp-rjg7-q26m | `@nestjs/platform-express` (API) | Cuando NestJS 11 publique una version que traiga multer >= 2.5.0 |
| `postcss ^8.5.23` | GHSA-qx2v-qp2m-jg93, GHSA-6g55-p6wh-862q, GHSA-r28c-9q8g-f849, GHSA-fxqj-rqcc-2cmp | `next` (trae 8.4.31) | Cuando Next 15.5.x traiga postcss >= 8.5.23 |
| `sharp ^0.35.5` | GHSA-f88m-g3jw-g9cj, GHSA-rgj7-g3m4-5g8c, GHSA-wq5f-xc86-pv6w | `next` y `apps/mobile` (iconos) | Cuando Next traiga sharp >= 0.35.5 |
| `deepmerge-ts ^8.0.2` | GHSA-ggr8-5vv4-36mx | `prisma` > `@prisma/config` (Prisma 6.19) | Cuando Prisma publique una version que use deepmerge-ts >= 8 |

## Excepciones aprobadas por el dueno (2026-11-07)

`deepmerge-ts` 7 -> 8 y `sharp` 0.34 -> 0.35 saltan de version mas alla de la "misma familia". Se aceptaron
de forma explicita porque es la unica forma de cerrar avisos altos. Comprobado con: tests de la API,
`prisma validate`, `prisma migrate status`, build de web y mobile y `pnpm --filter @finanzas/mobile icons`
(los iconos salen identicos).

## Avisos conocidos fuera de alcance

`pnpm audit --prod --audit-level high` termina en 0. El audit completo aun lista avisos solo de
herramientas de desarrollo (no se publican): `vitest` 3.2.4, `tinypool`, `@vitest/mocker`, `glob`,
`minimatch` (via `@vitest/coverage-v8`) y `deepmerge` (via `jest` 29). Arreglarlos exige subir vitest o jest
de version mayor; se revisan en la fecha indicada.
