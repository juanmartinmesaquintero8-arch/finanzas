import { defaultFirstDueDate, firstDueDateFor } from './installments';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('firstDueDateFor', () => {
  const cases: [string, number, number, string, string][] = [
    // [descripción, día de pago, corte, compra, primera cuota]
    ['compra el mismo día del corte entra en ese extracto', 25, 10, '2026-03-10', '2026-03-25'],
    ['compra el día siguiente al corte pasa al extracto siguiente', 25, 10, '2026-03-11', '2026-04-25'],
    ['día de pago menor que el corte: compra el día del corte', 5, 20, '2026-03-20', '2026-04-05'],
    ['día de pago menor que el corte: compra el día siguiente', 5, 20, '2026-03-21', '2026-05-05'],
    ['día de pago menor que el corte: compra antes del corte', 5, 20, '2026-03-02', '2026-04-05'],
    ['corte 31 en febrero de año normal', 5, 31, '2026-02-10', '2026-03-05'],
    ['corte 31 y compra el 28 de febrero (año normal)', 5, 31, '2026-02-28', '2026-03-05'],
    ['corte 31 y compra el 1 de marzo', 5, 31, '2026-03-01', '2026-04-05'],
    ['corte 31 en febrero de año bisiesto, compra el 28', 5, 31, '2024-02-28', '2024-03-05'],
    ['corte 31 en febrero de año bisiesto, compra el 29', 5, 31, '2024-02-29', '2024-03-05'],
    ['corte 31 en abril (mes de 30 días)', 10, 31, '2026-04-30', '2026-05-10'],
    ['día de pago ajustado igual al corte ajustado pasa al mes siguiente', 30, 31, '2026-02-01', '2026-03-30'],
    ['diciembre a enero: compra después del corte, pago menor', 5, 20, '2026-12-21', '2027-02-05'],
    ['diciembre a enero: compra después del corte, pago mayor', 25, 10, '2026-12-11', '2027-01-25'],
    ['diciembre: compra antes del corte, pago menor', 5, 20, '2026-12-10', '2027-01-05'],
    ['compra el 31 con corte 10', 25, 10, '2026-01-31', '2026-02-25'],
    ['día de pago 31 se ajusta a fin de mes', 31, 10, '2026-02-05', '2026-02-28'],
  ];

  it.each(cases)('%s', (_name, dueDay, cutDay, purchase, expected) => {
    expect(firstDueDateFor(d(purchase), dueDay, cutDay)).toEqual(d(expected));
  });

  it('sin corte es idéntico a la regla de hoy (mes siguiente al de la compra)', () => {
    for (let offset = 0; offset < 1500; offset += 1) {
      const purchase = new Date(Date.UTC(2024, 0, 1 + offset));
      for (const dueDay of [1, 5, 15, 28, 29, 30, 31]) {
        expect(firstDueDateFor(purchase, dueDay)).toEqual(defaultFirstDueDate(purchase, dueDay));
        expect(firstDueDateFor(purchase, dueDay, undefined)).toEqual(defaultFirstDueDate(purchase, dueDay));
      }
    }
  });

  it('con corte, la primera cuota siempre es posterior a la compra', () => {
    for (let offset = 0; offset < 800; offset += 3) {
      const purchase = new Date(Date.UTC(2024, 0, 1 + offset));
      for (const cutDay of [1, 10, 28, 30, 31]) {
        for (const dueDay of [2, 15, 29, 31]) {
          if (cutDay === dueDay) continue;
          expect(firstDueDateFor(purchase, dueDay, cutDay).getTime()).toBeGreaterThan(purchase.getTime());
        }
      }
    }
  });
});
