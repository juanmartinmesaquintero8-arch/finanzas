import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppBottomNav } from './AppBottomNav';

let pathname = '/';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

describe('AppBottomNav', () => {
  it('muestra las 4 pestañas y marca la activa según la ruta de Next', () => {
    pathname = '/programados';
    render(<AppBottomNav />);
    const links = screen.getByRole('navigation', { name: 'Principal' }).querySelectorAll('a');
    expect(Array.from(links).map((a) => a.textContent)).toEqual(['Inicio', 'Historial', 'Agregar', 'Programados']);
    expect(screen.getByRole('link', { name: 'Programados' })).toHaveAttribute('aria-current', 'page');
  });
});
