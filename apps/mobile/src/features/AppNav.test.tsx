import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppNav } from './AppNav';

vi.mock('next/navigation', () => ({ usePathname: () => '/ajustes/' }));

describe('AppNav (móvil)', () => {
  it('muestra Inicio, Historial, Agregar, Programados y Ajustes, con Ajustes activo', () => {
    render(<AppNav />);
    const links = screen.getByRole('navigation', { name: 'Principal' }).querySelectorAll('a');
    expect(Array.from(links).map((a) => a.textContent)).toEqual(['Inicio', 'Historial', 'Agregar', 'Programados', 'Ajustes']);
    expect(screen.getByRole('link', { name: 'Ajustes' })).toHaveAttribute('aria-current', 'page');
  });
});
