# Mis Finanzas

Una aplicación para controlar tu dinero: tus cuentas (Efectivo, Bancolombia, Nu…), tus ingresos y gastos, y lo que te toca pagar más adelante.

## La forma fácil: doble clic

En tu escritorio haz **doble clic en "Abrir Mis Finanzas"**. Se encienden solas la base de datos y la app, y se abre tu navegador (tarda unos 15 segundos).

Para apagarla, cierra las dos ventanas llamadas **"Finanzas"** de la barra de tareas.
(Si el acceso directo se borra, el mismo botón está en esta carpeta: `Abrir Finanzas.cmd`.)

## La forma manual (4 pasos)

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

## Usarla en el celular

Hay una versión pensada para tu celular Android. **Tus datos se guardan solo en el celular**: no hay servidor y nadie más los ve.

- Se instala como una app normal (con su ícono) y funciona sin internet.
- Dentro de la app, en **Ajustes**, puedes hacer una **copia de seguridad** (un archivo que puedes mandarte por WhatsApp, Drive o correo) y **recuperarla** si cambias de celular.
- Si es tu primera vez, la app te deja mirar todo con **datos de ejemplo** y luego borrarlos.

Pasos para instalarla en tu celular: _(se completarán cuando tengamos la dirección de la app)_.

Para probarla en el computador: `pnpm dev:mobile` y abre [http://localhost:3100](http://localhost:3100).
