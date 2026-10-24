import { describe, expect, it, vi } from 'vitest';
import { deliverBackup } from './deliver-backup';

const backup = { text: '{"version":1}', fileName: 'mis-finanzas-2026-03-10.json' };

function fakeDoc() {
  const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() } as unknown as HTMLAnchorElement;
  const doc = { createElement: vi.fn().mockReturnValue(anchor), body: { append: vi.fn() } } as unknown as Document;
  const url = { createObjectURL: vi.fn().mockReturnValue('blob:x'), revokeObjectURL: vi.fn() };
  return { anchor, doc, url };
}

describe('deliverBackup', () => {
  it('comparte el archivo con la hoja de compartir del teléfono (WhatsApp, Drive, correo)', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    const result = await deliverBackup(backup, { nav: { share, canShare } });
    expect(result).toBe('shared');
    const arg = share.mock.calls[0]![0] as { files: File[]; title: string };
    expect(arg.files[0]!.name).toBe(backup.fileName);
    expect(arg.files[0]!.type).toBe('application/json');
    expect(canShare).toHaveBeenCalledWith(expect.objectContaining({ files: expect.any(Array) }));
  });

  it('si la persona cierra la hoja de compartir no cuenta como copia hecha', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('cancelado', 'AbortError'));
    expect(await deliverBackup(backup, { nav: { share, canShare: () => true } })).toBe('cancelled');
  });

  it('descarga el archivo si el navegador no puede compartir archivos', async () => {
    const { anchor, doc, url } = fakeDoc();
    const result = await deliverBackup(backup, { nav: { canShare: () => false }, doc, url });
    expect(result).toBe('downloaded');
    expect(anchor.download).toBe(backup.fileName);
    expect(anchor.href).toBe('blob:x');
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(url.revokeObjectURL).toHaveBeenCalledWith('blob:x');
  });

  it('descarga si no existe la API de compartir', async () => {
    const { doc, url } = fakeDoc();
    expect(await deliverBackup(backup, { nav: {}, doc, url })).toBe('downloaded');
  });

  it('si compartir falla por otro motivo, descarga como respaldo', async () => {
    const { doc, url } = fakeDoc();
    const share = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    expect(await deliverBackup(backup, { nav: { share, canShare: () => true }, doc, url })).toBe('downloaded');
  });
});
