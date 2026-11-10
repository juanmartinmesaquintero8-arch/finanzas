# Diseño y plan: pago único por tarjeta y día de corte

## 1. Intención

El dueño pidió, el 2026-11-10:

1. Poder pagar más de una cuota o un valor distinto al de la cuota.
2. Que la app pregunte el día de corte de cada tarjeta.

Hoy la app solo registra cuotas completas, una por una, y calcula la primera cuota solo con el día de pago.

## 2. Decisiones del dueño (2026-11-10)

- **Un pago por tarjeta**, como el del extracto: la app reparte el valor.
- Si paga **de más**, la app pregunta cada vez qué hacer con la plata de más:
  - **terminar antes**: menos cuotas, misma cuota;
  - **bajar la cuota**: mismas cuotas, más baratas.

  Sugiere terminar antes.
- Puede pagar **de menos**. Lo que falta queda vencido y sigue restando del Saldo Real hasta que lo pague.

## 3. Decisiones de implementación (el dueño puede cambiarlas)

| Tema | Decisión | Por qué |
|---|---|---|
| Destino de la plata de más | La compra con mayor tasa, luego la más antigua. Se puede cambiar antes de confirmar | Ahorra más intereses |
| Botones por compra | "Pagar cuota" y "Liquidar" se reemplazan por **Pagar tarjeta**, con atajos "Lo de este mes" y "Todo" | Un solo camino, como el banco |
| Pagos hechos con el sistema anterior | Se pueden deshacer hasta el primer pago nuevo en esa tarjeta | Mezclar los dos sistemas al deshacer es riesgoso |
| Tarjetas sin día de corte | Siguen como hoy, con el aviso "Agrega el día de corte" | No cambia nada sin que el dueño lo decida |
| Pagar más que toda la deuda | No se permite; se muestra el máximo | La app no maneja saldo a favor |
| Pagar tarde o incompleto | Se avisa en el desglose que sube el interés del mes siguiente | El interés se calcula sobre lo que de verdad se debe |
| Mora | Fuera de alcance: no se calcula tasa de mora | Cada banco la aplica distinto |

## 4. Lo que sería un fracaso

- Perder o cambiar datos ya guardados: tarjetas, compras o pagos.
- Que, sin pagos nuevos, las cuotas o los intereses de hoy cambien.
- Que la suma de lo repartido no sea exactamente lo pagado, o que una cuota de capital suba al recalcular.
- Que un doble toque registre el pago dos veces.
- Que una copia de seguridad vieja deje de recuperarse.

## 5. Reglas

### 5.1 Día de corte
- `cutDay` de 1 a 31, opcional y distinto del día de pago.
- Primera cuota: el primer corte, ajustado a fin de mes, en la fecha de la compra o después; una compra del mismo día del corte entra en ese extracto. La cuota vence el primer día de pago estrictamente posterior a ese corte.
- Con corte, el manejo se cuenta por ciclo de facturación (del día siguiente al corte anterior hasta el corte) y vence el día de pago siguiente.
- Las compras ya guardadas conservan su fecha de primera cuota. Sin corte, todo funciona igual que hoy.

### 5.2 Estado de la deuda
- Cada pago queda guardado como un evento de la tarjeta con su reparto. El estado de cada cuota (vence, pagado, falta) se calcula a partir de esos eventos. Las cuotas pagadas con el sistema anterior cuentan como pagadas.
- Método colombiano: capital fijo por cuota, e interés de la cuota `k` = saldo de capital aún debido al corte que la generó × tasa, redondeado a la mitad hacia arriba. Pagando a tiempo, el resultado es idéntico al plan actual.
- Un pago parcial de una cuota cubre primero el interés y luego el capital. Lo que falta queda vencido y genera interés en la siguiente cuota.
- La fecha de un pago no puede ser futura ni anterior al último pago de esa tarjeta.
- Plata de más, con `B` = capital restante:
  - **terminar antes**: se mantiene la cuota de capital `q` y quedan `ceil(B / q)` cuotas;
  - **bajar la cuota**: con `n` cuotas restantes, `q' = B ÷ n`, `r' = B mod n`, y las primeras `r'` cuotas llevan `q' + 1`. La cuota de capital nunca sube.

### 5.3 Reparto de un pago
1. Lo vencido, de lo más antiguo a lo más nuevo. En la misma fecha: manejo, luego interés, luego capital.
2. Lo que vence hasta la próxima fecha de pago, en el mismo orden.
3. La plata de más, a la compra elegida (por defecto la de mayor tasa). Si la cierra, el resto pasa a la siguiente.

Antes de confirmar se muestra el desglose.

### 5.4 Movimientos y deshacer
- Por cada compra tocada, un gasto de capital con la categoría de la compra y uno de interés en "Intereses y manejo". Además, uno por cada cuota de manejo. Los de valor cero no se crean.
- El pago lleva un identificador creado al abrir el formulario; si ya existe, no se escribe nada. Todo se guarda en una sola escritura.
- "Deshacer último pago de la tarjeta" quita el pago completo y sus movimientos. Estos movimientos no se editan ni se borran desde Historial, salvo que el pago ya no exista.

## 6. Datos
- `DB_VERSION = 3`: solo añade el almacén `cardPayments` (por tarjeta y orden). No transforma nada de lo existente.
- Copias: v4 añade `cutDay`; v5 añade los pagos, con tope de 20.000 y validación de que las sumas cuadran. Las copias v1 a v4 se siguen recuperando.
- "Borrar todo", "Quitar datos de ejemplo" y "Recuperar copia" incluyen lo nuevo.

## 7. Plan por ramas
Cada rama lleva pruebas primero, revisión y control antes de publicarse. Van en secuencia.

| # | Rama | Entrega | Se prueba primero |
|---|---|---|---|
| 1 | `feat/tarjeta-dia-corte` | Día de corte en la tarjeta y cálculo de la primera cuota | Tabla de fechas: mismo día del corte, día siguiente, corte 31 en febrero, día de pago antes del corte. Ciclos de manejo. Sin corte nada cambia. Copia v4 |
| 2 | `feat/tarjeta-estado-pagos` | Cálculo de deuda con pagos parciales y de más (sin pantallas) | Sin pagos es idéntico al plan actual. Sumas exactas. Parcial cubre interés antes que capital. Las dos formas de recálculo nunca suben la cuota. Orden del reparto |
| 3 | `feat/tarjeta-pago-unico` | Guardado del pago, deshacer y copia v5 | Actualización v2 a v3 sin pérdida en navegador real, atomicidad, doble toque, deshacer, Historial |
| 4 | `feat/tarjeta-pago-pantalla` | Pantalla "Pagar tarjeta", desglose y pregunta | Formulario, desglose, flujo pagar y deshacer en navegador real |
