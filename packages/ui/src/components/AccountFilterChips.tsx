import Link from 'next/link';
import type { Account } from '../lib/types';
import ui from './ui.module.css';

interface Props {
  accounts: Account[];
  /** Cuenta elegida; sin valor significa "Todas". */
  selectedId?: string;
  /** Enlace de cada chip (sin id = "Todas"). Cada app define sus rutas. */
  hrefFor?: (accountId?: string) => string;
}

const defaultHrefFor = (id?: string) => (id ? `/historial?cuenta=${id}` : '/historial');

/** Chips para filtrar el historial por cuenta. */
export function AccountFilterChips({ accounts, selectedId, hrefFor = defaultHrefFor }: Props) {
  return (
    <div className={ui.chips} role="group" aria-label="Filtrar por cuenta">
      <Link href={hrefFor()} className={ui.chip} aria-current={selectedId ? undefined : 'true'} replace>
        Todas
      </Link>
      {accounts.map((a) => (
        <Link
          key={a.id}
          href={hrefFor(a.id)}
          className={ui.chip}
          aria-current={selectedId === a.id ? 'true' : undefined}
          replace
        >
          {a.name}
        </Link>
      ))}
    </div>
  );
}
