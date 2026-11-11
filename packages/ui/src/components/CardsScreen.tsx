'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import type { CardsApi } from '../lib/cards';
import { formatDueDate, formatMoneyCompact, formatMonthLong } from '../lib/format';
import type { Account, CardView, PurchaseView } from '../lib/types';
import { ConfirmPanel, FeeAwareConfirmPanel } from './CardPanels';
import styles from './CreditCards.module.css';
import ui from './ui.module.css';

// Carga diferida: los formularios sólo se descargan cuando el usuario los abre.
const loading = () => <p className={ui.empty}>Cargando…</p>;
const CardForm = dynamic(() => import('./CardForm').then((m) => m.CardForm), { loading });
const PurchaseForm = dynamic(() => import('./PurchaseForm').then((m) => m.PurchaseForm), { loading });
const CardPaymentForm = dynamic(() => import('./CardPaymentForm').then((m) => m.CardPaymentForm), { loading });

interface Props {
  cards: CardView[];
  accounts: Account[];
  today: string;
  api: CardsApi;
}

type Mode =
  | { kind: 'list' }
  | { kind: 'newCard' }
  | { kind: 'editCard'; card: CardView }
  | { kind: 'addPurchase'; cardId: string }
  | { kind: 'editPurchase'; purchase: PurchaseView }
  | { kind: 'payCard'; card: CardView };

/** Pantalla de tarjetas: una por tarjeta, y cada acción se confirma ahí mismo. Sólo presentación. */
export function CardsScreen({ cards, accounts, today, api }: Props) {
  const [mode, setModeState] = useState<Mode>({ kind: 'list' });
  const [notice, setNotice] = useState<string | null>(null);
  const formTop = useRef<HTMLDivElement>(null);
  const setMode = (next: Mode) => {
    setNotice(null);
    setModeState(next);
  };
  const toList = () => setModeState({ kind: 'list' });
  const toListWith = (message?: string) => {
    setNotice(message ?? null);
    toList();
  };

  // Al abrir un formulario desde abajo en la lista, se empieza a llenar desde su primer campo.
  useEffect(() => {
    if (mode.kind !== 'list') formTop.current?.scrollIntoView?.({ block: 'start' });
  }, [mode.kind]);

  if (mode.kind !== 'list') {
    return (
      <div ref={formTop} className={styles.formTop}>
        {mode.kind === 'newCard' && <CardForm accounts={accounts} checkRate={(t, b) => api.checkRate(t, b)} onSubmit={(input) => api.createCard(input)} onDone={toList} onCancel={toList} />}
        {mode.kind === 'editCard' && <CardForm key={mode.card.id} card={mode.card} accounts={accounts} checkRate={(t, b) => api.checkRate(t, b)} checkImpact={(input) => api.cardChangeImpact(mode.card.id, input)} onSubmit={(input) => api.updateCard(mode.card.id, input)} onDone={toList} onCancel={toList} />}
        {mode.kind === 'addPurchase' && <PurchaseForm cards={cards} today={today} api={api} initialCardId={mode.cardId} onDone={toListWith} onCancel={toList} />}
        {mode.kind === 'payCard' && <CardPaymentForm key={mode.card.id} card={mode.card} accounts={accounts} today={today} api={api} onDone={toListWith} onCancel={toList} />}
        {mode.kind === 'editPurchase' && <PurchaseForm key={mode.purchase.id} cards={cards} today={today} api={api} purchase={mode.purchase} onDone={toListWith} onCancel={toList} />}
      </div>
    );
  }

  const hasCreditAccount = accounts.some((a) => a.type === 'CREDIT');
  return (
    <div className={ui.stack}>
      {notice && (
        <p role="status" className={ui.notice}>
          {notice}
        </p>
      )}
      {hasCreditAccount && <p className={styles.warning}>Tienes una cuenta tipo tarjeta de crédito. Si registras aquí esa misma tarjeta, no sumes su deuda dos veces.</p>}
      <button type="button" className={ui.button} disabled={accounts.length === 0} onClick={() => setMode({ kind: 'newCard' })}>
        Agregar tarjeta
      </button>
      {accounts.length === 0 && <p className={styles.help}>Primero crea una cuenta desde la que pagarás la tarjeta.</p>}
      {cards.length === 0 ? (
        <p className={ui.empty}>Aquí verás lo que debes en tus tarjetas de crédito. Empieza agregando una.</p>
      ) : (
        <ul className={styles.list}>
          {cards.map((card) => (
            <CreditCardItem
              key={card.id}
              card={card}
              today={today}
              api={api}
              onPay={() => setMode({ kind: 'payCard', card })}
              onAddPurchase={() => setMode({ kind: 'addPurchase', cardId: card.id })}
              onEdit={() => setMode({ kind: 'editCard', card })}
              onEditPurchase={(purchase) => setMode({ kind: 'editPurchase', purchase })}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function overdue(amount: string, date: string, today: string): string {
  return `Vencida el ${formatDueDate(date, today)}: ${formatMoneyCompact(amount)}`;
}

function statusOf(p: PurchaseView, today: string): string {
  if (p.closedOn) return `Liquidada el ${formatDueDate(p.closedOn, today)}`;
  if (p.next && p.next.dueDate < today) return overdue(p.next.total, p.next.dueDate, today);
  if (p.next) return `Próxima: ${formatMoneyCompact(p.next.total)} el ${formatDueDate(p.next.dueDate, today)}`;
  return 'Pagada por completo';
}

function nextLine(card: CardView, today: string): string {
  if (!card.next) return 'Sin cuotas por pagar';
  if (card.next.date < today) return overdue(card.next.amount, card.next.date, today);
  return `Próxima cuota ${formatMoneyCompact(card.next.amount)} el ${formatDueDate(card.next.date, today)}`;
}

function CreditCardItem({ card, today, api, onPay, onAddPurchase, onEdit, onEditPurchase }: {
  card: CardView;
  today: string;
  api: CardsApi;
  onPay: () => void;
  onAddPurchase: () => void;
  onEdit: () => void;
  onEditPurchase: (purchase: PurchaseView) => void;
}) {
  // Solo una acción abierta por tarjeta, así no se mezclan dos confirmaciones.
  const [panel, setPanel] = useState<string | null>(null);
  const close = () => setPanel(null);
  // Con el primer pago único, los deshacer del sistema anterior dejan su lugar al de la tarjeta.
  const last = card.lastCardPayment;

  return (
    <li className={`${ui.card} ${styles.card}`}>
      <div className={styles.head}>
        <h2 className={styles.name}>{card.name}</h2>
        <p className={styles.debt}>Debes en total {formatMoneyCompact(card.debt)}</p>
        <p className={styles.next}>{nextLine(card, today)}</p>
        {BigInt(card.overdue) > 0n && <p className={`${styles.warning} ${styles.overdue}`}>Vencido {formatMoneyCompact(card.overdue)}</p>}
      </div>
      {card.cutDay === null && (
        <div className={styles.cutNotice}>
          <p className={styles.warning}>Agrega el día de corte para que las fechas de tus cuotas salgan exactas.</p>
          <button type="button" className={ui.buttonGhost} aria-label={`Agregar día de corte a ${card.name}`} onClick={onEdit}>
            Agregar día de corte
          </button>
        </div>
      )}
      {card.payable && (
        <button type="button" className={ui.button} aria-label={`Pagar tarjeta ${card.name}`} onClick={onPay}>
          Pagar tarjeta
        </button>
      )}
      <button type="button" className={ui.buttonGhost} aria-label={`Agregar compra en ${card.name}`} onClick={onAddPurchase}>
        Agregar compra
      </button>

      {card.purchases.length > 0 && (
        <ul className={styles.rows}>
          {card.purchases.map((p) => (
            <li key={p.id} className={styles.row}>
              <div className={styles.rowTop}>
                <span className={styles.desc}>{p.description}</span>
                <span className={styles.count}>
                  Pagadas {p.paidCount} · faltan {p.installmentCount - p.paidCount}
                </span>
              </div>
              <p className={styles.meta}>{statusOf(p, today)}</p>
              {panel === `undo:${p.id}` ? (
                <ConfirmPanel
                  label={`Deshacer último pago de ${p.description}`}
                  text="Esta cuota vuelve a quedar pendiente. Si la pagaste desde la app, el dinero vuelve a la cuenta; si la habías marcado como ya pagada, ningún saldo cambia."
                  confirmLabel="Sí, deshacer"
                  onConfirm={() => api.undoLastPayment(p.id, { installment: p.paidInstallments })}
                  onDone={close}
                  onCancel={close}
                />
              ) : panel === `delete:${p.id}` ? (
                <FeeAwareConfirmPanel
                  loadImpact={() => api.purchaseRemovalImpact(p.id)}
                  label={`Eliminar compra ${p.description}`}
                  text="Se quita la deuda de esta compra. Los pagos que ya hiciste se quedan en tu historial."
                  confirmLabel="Sí, eliminar"
                  onConfirm={() => api.removePurchase(p.id)}
                  onDone={close}
                  onCancel={close}
                />
              ) : (
                <div className={styles.actions}>
                  {!last && p.paidInstallments > 0 && !p.closedOn && (
                    <button type="button" className={ui.buttonGhost} aria-label={`Deshacer último pago: ${p.description}`} onClick={() => setPanel(`undo:${p.id}`)}>
                      Deshacer último pago
                    </button>
                  )}
                  <button type="button" className={ui.buttonGhost} aria-label={`Editar compra ${p.description}`} onClick={() => onEditPurchase(p)}>
                    Editar
                  </button>
                  <button type="button" className={ui.buttonGhost} aria-label={`Eliminar compra ${p.description}`} onClick={() => setPanel(`delete:${p.id}`)}>
                    Eliminar
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {card.pendingFees.length > 0 && (
        <div className={styles.fees}>
          <h3 className={styles.feesTitle}>Cuotas de manejo pendientes</h3>
          <ul className={styles.rows}>
            {card.pendingFees.map((f) => {
              const month = formatMonthLong(f.month);
              return (
                <li key={f.month} className={styles.row}>
                  <div className={styles.rowTop}>
                    <span className={styles.desc}>
                      Manejo {card.name} ({month})
                    </span>
                    <span className={styles.figure}>{formatMoneyCompact(f.amount)}</span>
                  </div>
                  <p className={styles.meta}>Vence el {formatDueDate(f.dueDate, today)}</p>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {last &&
        (panel === 'undo-card' ? (
          <ConfirmPanel
            label={`Deshacer último pago de la tarjeta ${card.name}`}
            text={`Se borra el pago de ${formatMoneyCompact(last.total)} del ${formatDueDate(last.paidOn, today)} y su dinero vuelve a la cuenta. Las cuotas que cubrió vuelven a quedar pendientes.`}
            confirmLabel="Sí, deshacer"
            cancelLabel="Volver"
            onConfirm={() => api.undoLastCardPayment(card.id, { paymentId: last.id })}
            onDone={close}
            onCancel={close}
          />
        ) : (
          <div className={styles.actions}>
            <button type="button" className={ui.buttonGhost} aria-label={`Deshacer último pago de la tarjeta ${card.name}`} onClick={() => setPanel('undo-card')}>
              Deshacer último pago de la tarjeta
            </button>
          </div>
        ))}

      {!last &&
        card.lastPaidFeeMonth &&
        (panel === 'undo-fee' ? (
          <ConfirmPanel
            label={`Deshacer último pago de manejo de ${card.name}`}
            text="Esta cuota de manejo vuelve a quedar pendiente y el dinero vuelve a la cuenta."
            confirmLabel="Sí, deshacer"
            onConfirm={() => api.undoLastFee(card.id, { month: card.lastPaidFeeMonth! })}
            onDone={close}
            onCancel={close}
          />
        ) : (
          <div className={styles.actions}>
            <button type="button" className={ui.buttonGhost} aria-label={`Deshacer último pago de manejo de ${card.name}`} onClick={() => setPanel('undo-fee')}>
              Deshacer último pago de manejo
            </button>
          </div>
        ))}

      {panel === 'delete-card' ? (
        <ConfirmPanel
          label={`Eliminar tarjeta ${card.name}`}
          text="Se borran la tarjeta y sus compras. Los pagos que ya hiciste se quedan en tu historial."
          confirmLabel="Sí, eliminar"
          onConfirm={() => api.removeCard(card.id)}
          onDone={close}
          onCancel={close}
        />
      ) : (
        <div className={styles.actions}>
          <button type="button" className={ui.buttonGhost} aria-label={`Editar tarjeta ${card.name}`} onClick={onEdit}>
            Editar tarjeta
          </button>
          <button type="button" className={ui.buttonGhost} aria-label={`Eliminar tarjeta ${card.name}`} onClick={() => setPanel('delete-card')}>
            Eliminar tarjeta
          </button>
        </div>
      )}
    </li>
  );
}
