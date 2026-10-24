import Link from 'next/link';
import { formatMoneyView } from '../lib/format';
import type { Projection } from '../lib/types';
import styles from './AccountCards.module.css';

const defaultEditHref = (id: string) => `/cuentas/${id}/editar`;

interface Props {
  accounts: Projection['accounts'];
  /** Enlace de edición por cuenta (cada app define sus rutas). */
  editHref?: (accountId: string) => string;
}

/** Fila deslizable de tarjetas, una por cuenta, con saldo y disponible. */
export function AccountCards({ accounts, editHref = defaultEditHref }: Props) {
  return (
    <ul className={styles.row} aria-label="Tus cuentas">
      {accounts.map((a) => (
        <li key={a.accountId} className={styles.card}>
          <span className={styles.name}>{a.name}</span>
          <span className={styles.balance}>{formatMoneyView(a.balance)}</span>
          <span className={styles.available}>
            Disponible <strong>{formatMoneyView(a.available)}</strong>
          </span>
          <Link href={editHref(a.accountId)} className={styles.edit} aria-label={`Editar cuenta ${a.name}`}>
            Editar
          </Link>
        </li>
      ))}
    </ul>
  );
}
