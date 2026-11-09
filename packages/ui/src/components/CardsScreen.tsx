'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import type { CardsApi } from '../lib/cards';
import { formatDueDate, formatMoneyCompact, monthName } from '../lib/format';
import type { Account, CardView, PurchaseView } from '../lib/types';
import { ConfirmPanel, PayFeePanel, PayInstallmentPanel, SettlePanel } from './CardPanels';
import styles from './CreditCards.module.css';
import ui from './ui.module.css';

// Carga diferida: los formularios sólo se descargan cuando el usuario los abre.
const loading = () => <p className={ui.empty}>Cargando…</p>;
const CardForm = dynamic(() => import('./CardForm').then((m) => m.CardForm), { loading });
const PurchaseForm = dynamic(() => import('./PurchaseForm').then((m) => m.PurchaseForm), { loading });

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
  | { kind: 'editPurchase'; purchase: PurchaseView };

/** Pantalla de tarjetas: una por tarjeta, y cada acción se confirma ahí mismo. Sólo presentación. */
export function CardsScreen({ cards, accounts, today, api }: Props) {
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const formTop = useRef<HTMLDivElement>(null);
  const toList = () => setMode({ kind: 'list' });

  // Al abrir un formulario desde abajo en la lista, se empieza a llenar desde su primer campo.
  useEffect(() => {
    if (mode.kind !== 'list') formTop.current?.scrollIntoView?.({ block: 'start' });
  }, [mode.kind]);

  if (mode.kind !== 'list') {
    return (
      <div ref={formTop} className={styles.formTop}>
        {mode.kind === 'newCard' && <CardForm accounts={accounts} checkRate={(t, b) => api.checkRate(t, b)} onSubmit={(input) => api.createCard(input)} onDone={toList} onCancel={toList} />}
        {mode.kind === 'editCard' && <CardForm key={mode.card.id} card={mode.card} accounts={accounts} checkRate={(t, b) => api.checkRate(t, b)} onSubmit={(input) => api.updateCard(mode.card.id, input)} onDone={toList} onCancel={toList} />}
        {mode.kind === 'addPurchase' && <PurchaseForm cards={cards} today={today} api={api} initialCardId={mode.cardId} onDone={toList} onCancel={toList} />}
        {mode.kind === 'editPurchase' && <PurchaseForm key={mode.purchase.id} cards={cards} today={today} api={api} purchase={mode.purchase} onDone={toList} onCancel={toList} />}
      </div>
    );
  }

  const hasCreditAccount = accounts.some((a) => a.type === 'CREDIT');
  return (
    <div className={ui.stack}>
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
              accounts={accounts}
              today={today}
              api={api}
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

function statusOf(p: PurchaseView, today: string): string {
  if (p.closedOn) return `Liquidada el ${formatDueDate(p.closedOn, today)}`;
  if (p.next) return `Próxima: ${formatMoneyCompact(p.next.total)} el ${formatDueDate(p.next.dueDate, today)}`;
  return 'Pagada por completo';
}

function CreditCardItem({ card, accounts, today, api, onAddPurchase, onEdit, onEditPurchase }: {
  card: CardView;
  accounts: Account[];
  today: string;
  api: CardsApi;
  onAddPurchase: () => void;
  onEdit: () => void;
  onEditPurchase: (purchase: PurchaseView) => void;
}) {
  // Solo una acción abierta por tarjeta, así no se mezclan dos confirmaciones.
  const [panel, setPanel] = useState<string | null>(null);
  const close = () => setPanel(null);
  const accountId = accounts.some((a) => a.id === card.paymentAccountId) ? card.paymentAccountId : '';
  const payment = { accounts, accountId, today, onCancel: close, onDone: close };

  return (
    <li className={`${ui.card} ${styles.card}`}>
      <div className={styles.head}>
        <h2 className={styles.name}>{card.name}</h2>
        <p className={styles.debt}>Debes en total {formatMoneyCompact(card.debt)}</p>
        <p className={styles.next}>{card.next ? `Próxima cuota ${formatMoneyCompact(card.next.amount)} el ${formatDueDate(card.next.date, today)}` : 'Sin cuotas por pagar'}</p>
      </div>
      <button type="button" className={ui.button} aria-label={`Agregar compra en ${card.name}`} onClick={onAddPurchase}>
        Agregar compra
      </button>

      {card.purchases.length > 0 && (
        <ul className={styles.rows}>
          {card.purchases.map((p) => (
            <li key={p.id} className={styles.row}>
              <div className={styles.rowTop}>
                <span className={styles.desc}>{p.description}</span>
                <span className={styles.count}>
                  {p.paidInstallments}/{p.installments} cuotas
                </span>
              </div>
              <p className={styles.meta}>{statusOf(p, today)}</p>
              {panel === `pay:${p.id}` && p.next ? (
                <PayInstallmentPanel {...payment} description={p.description} installment={p.next} onConfirm={(input) => api.payInstallment(p.id, input)} />
              ) : panel === `settle:${p.id}` && p.settle ? (
                <SettlePanel {...payment} description={p.description} offer={p.settle} onConfirm={(input) => api.settle(p.id, input)} />
              ) : panel === `undo:${p.id}` ? (
                <ConfirmPanel
                  label={`Deshacer último pago de ${p.description}`}
                  text="Se borra el último pago de esta compra y su cuota vuelve a quedar pendiente."
                  confirmLabel="Sí, deshacer"
                  onConfirm={() => api.undoLastPayment(p.id, { installment: p.paidInstallments })}
                  onDone={close}
                  onCancel={close}
                />
              ) : panel === `delete:${p.id}` ? (
                <ConfirmPanel
                  label={`Eliminar compra ${p.description}`}
                  text="Se quita la deuda de esta compra. Los pagos que ya hiciste se quedan en tu historial."
                  confirmLabel="Sí, eliminar"
                  onConfirm={() => api.removePurchase(p.id)}
                  onDone={close}
                  onCancel={close}
                />
              ) : (
                <div className={styles.actions}>
                  {p.next && (
                    <button type="button" className={ui.button} aria-label={`Pagar cuota: ${p.description}`} onClick={() => setPanel(`pay:${p.id}`)}>
                      Pagar cuota
                    </button>
                  )}
                  {p.paidInstallments > 0 && !p.closedOn && (
                    <button type="button" className={ui.buttonGhost} aria-label={`Deshacer último pago: ${p.description}`} onClick={() => setPanel(`undo:${p.id}`)}>
                      Deshacer último pago
                    </button>
                  )}
                  {p.settle && (
                    <button type="button" className={ui.buttonGhost} aria-label={`Liquidar: ${p.description}`} onClick={() => setPanel(`settle:${p.id}`)}>
                      Liquidar
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
              const name = monthName(f.month);
              const label = `Pagar manejo de ${name}`;
              return (
                <li key={f.month} className={styles.row}>
                  <div className={styles.rowTop}>
                    <span className={styles.desc}>Manejo de {name}</span>
                    <span className={styles.figure}>{formatMoneyCompact(f.amount)}</span>
                  </div>
                  <p className={styles.meta}>Vence el {formatDueDate(f.dueDate, today)}</p>
                  {panel === `fee:${f.month}` ? (
                    <PayFeePanel {...payment} label={label} amount={f.amount} onConfirm={(input) => api.payFee(card.id, f.month, input)} />
                  ) : (
                    <div className={styles.actions}>
                      <button type="button" className={ui.buttonGhost} aria-label={label} onClick={() => setPanel(`fee:${f.month}`)}>
                        Pagar
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

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
