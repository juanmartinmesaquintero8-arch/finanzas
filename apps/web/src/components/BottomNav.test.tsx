import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BottomNav } from './BottomNav';

let pathname = '/';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

describe('BottomNav', () => {
  it('tiene 4 pestañas: Inicio, Historial, Agregar, Programados', () => {
    render(<BottomNav />);
    const nav = screen.getByRole('navigation', { name: 'Principal' });
    const links = nav.querySelectorAll('a');
    expect(Array.from(links).map((a) => a.textContent)).toEqual(['Inicio', 'Historial', 'Agregar', 'Programados']);
    expect(links[2]).toHaveAttribute('href', '/agregar');
  });

  it('marca la pestaña activa con aria-current', () => {
    pathname = '/historial';
    render(<BottomNav />);
    expect(screen.getByRole('link', { name: 'Historial' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Inicio' })).not.toHaveAttribute('aria-current');
  });
});
