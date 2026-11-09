/** Tipo de programado: lo que se paga (gasto) o lo que se espera recibir (ingreso). */
export type ScheduledKind = 'expense' | 'income';

/** Todos los textos que cambian entre un gasto programado y un ingreso programado. */
export interface ScheduledCopy {
  placeholder: string;
  accountLabel: string;
  startLabel: string;
  endLabel: string;
  saveError: string;
  newButton: string;
  empty: string;
  settleLabel: string;
  settleError: string;
  deleteQuestion: string;
  nextLabel: string;
  noneLeft: string;
  describeError: string;
  accountError: string;
  startError: string;
  endError: string;
}

export const SCHEDULED_COPY: Record<ScheduledKind, ScheduledCopy> = {
  expense: {
    placeholder: 'Ej: Arriendo',
    accountLabel: 'Se paga desde',
    startLabel: 'Fecha del primer pago',
    endLabel: 'Fecha del último pago (opcional)',
    saveError: 'No pudimos guardar el gasto programado. Intenta de nuevo.',
    newButton: '+ Nuevo gasto programado',
    empty: 'No tienes gastos programados. Agrega el arriendo, el internet o lo que pagues seguido.',
    settleLabel: 'Ya lo pagué',
    settleError: 'No pudimos registrar el pago. Intenta de nuevo.',
    deleteQuestion: '¿Eliminar este gasto programado?',
    nextLabel: 'Próximo pago',
    noneLeft: 'Sin pagos pendientes',
    describeError: 'Escribe qué vas a pagar.',
    accountError: 'Elige de qué cuenta se paga.',
    startError: 'Elige la fecha del primer pago.',
    endError: 'El último pago no puede ser antes del primero.',
  },
  income: {
    placeholder: 'Ej: Sueldo',
    accountLabel: 'Se recibe en',
    startLabel: 'Fecha del primer ingreso',
    endLabel: 'Fecha del último ingreso (opcional)',
    saveError: 'No pudimos guardar el ingreso programado. Intenta de nuevo.',
    newButton: '+ Nuevo ingreso programado',
    empty: 'No tienes ingresos programados. Agrega tu sueldo o lo que recibes seguido.',
    settleLabel: 'Ya lo recibí',
    settleError: 'No pudimos registrar el ingreso. Intenta de nuevo.',
    deleteQuestion: '¿Eliminar este ingreso programado?',
    nextLabel: 'Próximo ingreso',
    noneLeft: 'Sin ingresos pendientes',
    describeError: 'Escribe qué vas a recibir.',
    accountError: 'Elige a qué cuenta llega.',
    startError: 'Elige la fecha del primer ingreso.',
    endError: 'El último ingreso no puede ser antes del primero.',
  },
};
