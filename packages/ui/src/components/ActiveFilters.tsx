import Link from 'next/link';
import styles from './SpendingBreakdown.module.css';

export interface ActiveFilter {
  /** Lo que se ve: "Mercado", "Febrero 2026". */
  label: string;
  /** Lo que lee el lector de pantalla: "Quitar filtro de categoría: Mercado". */
  removeLabel: string;
  /** Dirección sin este filtro. */
  href: string;
}

/** Filtros activos del historial; tocar uno lo quita. */
export function ActiveFilters({ filters }: { filters: ActiveFilter[] }) {
  if (filters.length === 0) return null;
  return (
    <div className={styles.activeFilters}>
      {filters.map((f) => (
        <Link key={f.removeLabel} href={f.href} className={styles.filterChip} aria-label={f.removeLabel} replace>
          <span>{f.label}</span>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
            <path d="M3 3l8 8M11 3l-8 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </Link>
      ))}
    </div>
  );
}
