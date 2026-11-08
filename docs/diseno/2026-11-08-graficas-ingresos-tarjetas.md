# Diseño y plan: gráficas, ingresos programados y tarjetas de crédito

## 1. Intención

El dueño usa la app solo en el celular y quiere tres cosas:

1. Ver en qué se le va la plata.
2. Registrar ingresos programados, como ya registra gastos programados.
3. Controlar las cuotas de sus tarjetas de crédito: lo que debe, a cuántas cuotas, la cuota de manejo y los intereses.

## 2. Decisiones del dueño (2026-11-08)

- La deuda se registra **por cada compra**.
- Con intereses, **la cuota va bajando**: abono fijo a capital más intereses sobre lo que falta.
- Cuota de manejo "solo con movimiento": se cobra en los meses con una **compra nueva** en esa tarjeta. Pagar cuotas viejas no cuenta.
- El Saldo Real Disponible resta **solo lo que vence** hasta la fecha elegida. La deuda total se muestra aparte.
- El diseño de las pantallas y los demás detalles quedan a criterio de la implementación, avisándole lo decidido.

## 3. Decisiones de implementación (el dueño puede cambiarlas)

| Tema | Decisión | Por qué |
|---|---|---|
| Lugar de las gráficas | Dentro de Historial, selector "Movimientos / En qué gasto", y una tarjeta pequeña en Inicio | No añade pestañas |
| Lugar de ingresos y tarjetas | Dentro de Programados, selector "Gastos / Ingresos / Tarjetas" | Reúne todo lo pactado |
| Forma de la gráfica | Barras horizontales de un solo color, en HTML/CSS, sin librería | Es lo más legible en un celular y pesa 0 kB |
| Compras a cuotas en la gráfica | Cuentan **cuando se pagan** | Evita contar doble |
| Cuotas vencidas sin pagar | Siguen restando al Saldo Real | La deuda sigue viva |
| Cambiar la tasa de una tarjeta | Solo afecta compras nuevas | No altera lo ya pactado |
| Compra a 1 cuota | Sin interés por defecto, editable | Es lo habitual |
| Cuota de manejo | Se cobra el día de pago del mes siguiente | Es como llega en el extracto |
| Fecha de la tarjeta | Solo se pide el día de pago | Más simple |
| Interés | Es un **estimado**; el monto de cada pago se puede ajustar al extracto | Cada banco calcula distinto |

## 4. Fuera de alcance

- Abonos parciales a capital.
- Importar extractos del banco.
- Cambios en la API o la web, que solo deben seguir compilando y con pruebas en verde.
- Convertir cuentas tipo `CREDIT` existentes en tarjetas. Se muestra un aviso si existe alguna, para no contar doble.

## 5. Lo que sería un fracaso

- Perder datos al actualizar la app, o que no abra porque cambió la base de datos.
- Que una copia de seguridad vieja deje de recuperarse.
- Que las cuotas no sumen exactamente lo que se debe.
- Que un ingreso esperado haga ver más dinero en el Saldo Real.
- Que un doble toque registre un pago dos veces.
- Que "Borrar todo" o "Quitar datos de ejemplo" dejen datos de tarjetas o ingresos.
- Cualquier cálculo de dinero o de tasa con decimales de punto flotante.

## 6. Reglas de cálculo

### 6.1 Tasa
- Entero en millonésimas: 1 ppm = 0,0001 %. El usuario escribe `1,87` y elige M.V. o E.A.; se procesa solo con dígitos, máximo 4 decimales.
- Topes: M.V. ≤ 10 %, E.A. ≤ 200 %. Advertencia, sin bloquear, si la M.V. parece una tasa anual.
- E.A. a mensual, solo con `BigInt`: con `S = 10^12`, búsqueda binaria del mayor `y` tal que `y^12 ≤ (S + EA·S/10^6)·S^11`; luego `ppm = (y − S + 500000) / 1000000`. Control: 26,82 % E.A. → 19.997 ppm.

### 6.2 Cuotas
- `q = D ÷ N`, `r = D mod N`. Capital: cuota 1 = `q + r`; las demás = `q`.
- Saldo: `B1 = D`; `Bk = (N − k + 1) · q` para `k ≥ 2`.
- Interés de la cuota `k`: `(Bk · ppm + 500000) / 1000000`.
- La suma del capital es exactamente `D` y la cuota nunca sube. Control: 1.200.000 a 12 cuotas al 2 % M.V. da 156.000 de interés.
- Primera cuota: día de pago del mes siguiente a la compra, editable. Las siguientes caen el mismo día, ajustadas a fin de mes sin acumular el recorte.
- Las cuotas no se guardan: se calculan desde la compra.

### 6.3 Cuota de manejo
- La del mes `M` vence el día de pago de `M + 1`, solo para `M` desde el inicio de la tarjeta y posterior a lo ya pagado.
- Con movimiento: exige una compra con fecha en `M`. En meses futuros sin compra conocida no se genera.

### 6.4 Saldos
- Saldo Real Disponible: no cambia su definición con los ingresos. Resta también cuotas, intereses y manejo que vencen hasta la fecha, y las vencidas sin pagar.
- Se añade una línea secundaria: "Si llega lo que esperas recibir: $X", y un aviso si en algún día intermedio faltaría plata antes de que llegue el ingreso.
- Comprar con tarjeta no cambia el patrimonio; pagar la cuota sí lo baja.

### 6.5 Pagos de tarjeta
- Una sola escritura. Por cada cuota: un gasto de capital con la categoría de la compra y otro de interés en "Intereses y manejo".
- Identificadores deterministas por compra y cuota, para que un doble toque no duplique.
- Se paga en orden. Hay "Deshacer último pago". Estos movimientos no se borran desde Historial.
- "Liquidar": capital restante más solo el interés de la próxima cuota.
- Con cuotas pagadas solo se edita descripción y categoría. Borrar conserva los pagos reales y quita la deuda restante.
- Compras antiguas: campo "cuotas ya pagadas", sin crear movimientos.

### 6.6 Gráficas
- Solo `EXPENSE`, por mes, sin transferencias. Hasta 5 categorías, más "Sin categoría" y "Otras".
- Normalización: recortar, unir espacios, quitar tildes de vocales conservando la ñ, minúsculas; vacío es "Sin categoría". Se muestra la grafía más usada.
- Mes en curso: se compara con los mismos días del mes anterior.
- Rendimiento: lectura por lotes cediendo el hilo, sin crear entidades. 200.000 filas < 150 ms en dominio (`vitest bench`).

## 7. Datos

- **Corregir antes:** `upgrade(db)` en `apps/mobile/src/data/database.ts` no mira la versión; subir la versión sin arreglarlo impide abrir la app.
- `DB_VERSION = 2`, con un solo paso que añade `scheduledIncomes`, `creditCards` y `cardPurchases`. Se manejan `blocked` y `blocking` con un mensaje claro.
- `BACKUP_VERSION = 2`: en las copias v1 lo nuevo vale vacío; v2 lo exige. `MAX_ITEMS`: `scheduledIncomes` 2.000, `creditCards` 100, `cardPurchases` 5.000.
- `DATA_STORES`, `replaceAll`, `clearAll`, `removeSample` y los datos de ejemplo incluyen lo nuevo.
- `AccountService.remove` bloquea cuentas usadas por tarjetas o ingresos.

## 8. Plan por ramas

Cada rama: pruebas primero (vistas en rojo), revisión de código antes de unir, todas las pruebas en verde y publicación con el control automático. Van en secuencia.

| # | Rama | Entrega | Se prueba primero |
|---|---|---|---|
| 1 | `feat/graficas-gasto` | Gráfica de categorías, selector de mes, comparación, tarjeta en Inicio, filtro en Historial | Ñ y tildes, transferencias fuera, cambio de mes, mes en curso, rendimiento |
| 2 | `chore/esquema-v2` | Base de datos y copias v2, sin nada visible | Una base v1 real con datos sobrevive; copia v1 se recupera; `blocked`; borrar todo limpia lo nuevo |
| 3 | `feat/ingresos-programados` | Ingresos, botón "Ya lo recibí", línea secundaria, categoría en programados | Saldo Real idéntico al de hoy; punto más bajo; ida y vuelta de copia |
| 4 | `feat/tarjetas-dominio` | Tasa, plan de cuotas y manejo, sin pantallas | Suma exacta para todo `D` y `N`; tabla E.A.; cuotas no crecientes; reglas de manejo |
| 5 | `feat/tarjetas-app` | Tarjetas, compras, vista previa, pagos, Saldo Real y deuda total | Pago atómico, doble toque, deshacer, liquidar, proyección, copia |

Las pantallas siguen el sistema visual actual, con textos en español simple, en claro y oscuro, y con botones de 48 px.
