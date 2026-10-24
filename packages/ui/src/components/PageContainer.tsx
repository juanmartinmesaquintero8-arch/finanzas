import type { ReactNode } from 'react';
import styles from './PageContainer.module.css';

/** Contenedor de página: ancho máximo, márgenes seguros de pantalla y espacio para la barra inferior. */
export function PageContainer({ children }: { children: ReactNode }) {
  return <main className={styles.main}>{children}</main>;
}
