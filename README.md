# Mis Finanzas

Una aplicación para controlar tu dinero: tus cuentas (Efectivo, Bancolombia, Nu…), tus ingresos y gastos, y lo que te toca pagar más adelante.

## Cómo abrirla (4 pasos)

**1. Abre una terminal en esta carpeta.**
En el Explorador de archivos entra a `C:\Users\juanm\dev\finanzas`, haz clic en la barra de direcciones, escribe `powershell` y presiona Enter.

**2. Enciende la base de datos** (es donde se guardan tus datos). Escribe esto y presiona Enter:

```
pnpm db:start
```

Deja esa ventana abierta; no la cierres mientras uses la app.

**3. Enciende la app.** Abre una SEGUNDA terminal como en el paso 1 y escribe:

```
pnpm dev
```

Espera a que aparezca la palabra `Ready` (puede tardar un minuto la primera vez).

**4. Ábrela en tu navegador:** [http://localhost:3000](http://localhost:3000)

Para apagar todo, presiona `Ctrl + C` en cada terminal.

> Si al ejecutar `pnpm dev` dice que la base de datos no está encendida, repite el paso 2.

## Extras

- **Atajo:** en tu escritorio hay un acceso directo llamado "Finanzas (proyecto)" que abre esta carpeta.
- **Datos de ejemplo:** si la app está vacía y quieres ver cómo se ve con datos, con la base de datos encendida escribe `pnpm db:seed`. Solo carga los ejemplos si todavía no tienes cuentas.
- **Si la base de datos muestra un aviso de "UTF8":** escribe `pnpm db:start --reset-encoding`. Ojo: esto **borra** los datos guardados y deja la base lista para tildes y emojis.
