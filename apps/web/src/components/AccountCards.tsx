import { formatMoneyView } from '@/lib/format';
import type { Projection } from '@/lib/types';
import styles from './AccountCards.module.css';

interface Props {
  accounts: Projection['accounts'];
}

/** Fila deslizable de tarjetas, una por cuenta, con saldo y disponible. */
export function AccountCards({ accounts }: Props) {
  return (
    <ul className={styles.row} aria-label="Tus cuentas">
      {accounts.map((a) => (
        <li key={a.accountId} className={styles.card}>
          <span className={styles.name}>{a.name}</span>
          <span className={styles.balance}>{formatMoneyView(a.balance)}</span>
          <span className={styles.available}>
            Disponible <strong>{formatMoneyView(a.available)}</strong>
          </span>
        </li>
      ))}
    </ul>
  );
}
