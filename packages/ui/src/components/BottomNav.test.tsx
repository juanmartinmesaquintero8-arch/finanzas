import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BottomNav, DEFAULT_TABS } from './BottomNav';

describe('BottomNav', () => {
  it('con las pestañas por defecto tiene 4: Inicio, Historial, Agregar, Programados', () => {
    render(<BottomNav tabs={DEFAULT_TABS} pathname="/" />);
    const nav = screen.getByRole('navigation', { name: 'Principal' });
    const links = nav.querySelectorAll('a');
    expect(Array.from(links).map((a) => a.textContent)).toEqual(['Inicio', 'Historial', 'Agregar', 'Programados']);
    expect(links[2]).toHaveAttribute('href', '/agregar');
  });

  it('marca la pestaña activa con aria-current', () => {
    render(<BottomNav tabs={DEFAULT_TABS} pathname="/historial" />);
    expect(screen.getByRole('link', { name: 'Historial' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Inicio' })).not.toHaveAttribute('aria-current');
  });

  it('es parametrizable: acepta otras pestañas (p. ej. Ajustes) y adapta las columnas', () => {
    const tabs = [...DEFAULT_TABS, { href: '/ajustes', label: 'Ajustes', icon: null }];
    render(<BottomNav tabs={tabs} pathname="/ajustes/" />);
    expect(screen.getByRole('link', { name: 'Ajustes' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('list')).toHaveStyle({ gridTemplateColumns: 'repeat(5, 1fr)' });
  });
});
