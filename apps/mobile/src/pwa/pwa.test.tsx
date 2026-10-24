import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { InstallPrompt, InstallProvider } from './install';
import { registerServiceWorker } from './register-sw';
import { requestPersistentStorage } from './storage';

describe('requestPersistentStorage', () => {
  it('pide almacenamiento persistente para que Android no borre los datos', async () => {
    const storage = { persisted: vi.fn().mockResolvedValue(false), persist: vi.fn().mockResolvedValue(true) };
    expect(await requestPersistentStorage(storage)).toBe(true);
    expect(storage.persist).toHaveBeenCalledOnce();
  });

  it('si ya era persistente no vuelve a pedirlo', async () => {
    const storage = { persisted: vi.fn().mockResolvedValue(true), persist: vi.fn() };
    expect(await requestPersistentStorage(storage)).toBe(true);
    expect(storage.persist).not.toHaveBeenCalled();
  });

  it('no falla si el navegador no lo soporta o lo rechaza', async () => {
    expect(await requestPersistentStorage(undefined)).toBe(false);
    expect(await requestPersistentStorage({ persisted: vi.fn().mockResolvedValue(false), persist: vi.fn().mockResolvedValue(false) })).toBe(false);
    expect(await requestPersistentStorage({ persisted: vi.fn().mockRejectedValue(new Error('x')), persist: vi.fn() })).toBe(false);
  });
});

describe('registerServiceWorker', () => {
  it('registra sw.js respetando el basePath y su alcance', async () => {
    const register = vi.fn().mockResolvedValue({});
    expect(await registerServiceWorker({ serviceWorker: { register } }, '/finanzas', true)).toBe(true);
    expect(register).toHaveBeenCalledWith('/finanzas/sw.js', { scope: '/finanzas/' });
  });

  it('con basePath vacío usa la raíz', async () => {
    const register = vi.fn().mockResolvedValue({});
    await registerServiceWorker({ serviceWorker: { register } }, '', true);
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });

  it('no registra en desarrollo, sin soporte o si falla', async () => {
    const register = vi.fn().mockResolvedValue({});
    expect(await registerServiceWorker({ serviceWorker: { register } }, '', false)).toBe(false);
    expect(register).not.toHaveBeenCalled();
    expect(await registerServiceWorker({}, '', true)).toBe(false);
    expect(await registerServiceWorker({ serviceWorker: { register: vi.fn().mockRejectedValue(new Error('x')) } }, '', true)).toBe(false);
  });
});

function installEvent() {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome: 'accepted' });
  return event;
}

describe('InstallPrompt (Instalar en mi celular)', () => {
  it('no muestra nada hasta que el navegador permite instalar', () => {
    render(
      <InstallProvider>
        <InstallPrompt />
      </InstallProvider>,
    );
    expect(screen.queryByRole('button', { name: /instalar en mi celular/i })).not.toBeInTheDocument();
  });

  it('aparece con beforeinstallprompt, dispara el aviso del sistema y luego se oculta', async () => {
    render(
      <InstallProvider>
        <InstallPrompt />
      </InstallProvider>,
    );
    const event = installEvent();
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true); // se guarda para mostrarlo cuando la persona quiera
    await userEvent.click(await screen.findByRole('button', { name: /instalar en mi celular/i }));
    expect(event.prompt).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: /instalar en mi celular/i })).not.toBeInTheDocument());
  });

  it('se oculta cuando la app ya quedó instalada', async () => {
    render(
      <InstallProvider>
        <InstallPrompt />
      </InstallProvider>,
    );
    act(() => {
      window.dispatchEvent(installEvent());
    });
    expect(await screen.findByRole('button', { name: /instalar en mi celular/i })).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });
    expect(screen.queryByRole('button', { name: /instalar en mi celular/i })).not.toBeInTheDocument();
  });
});
