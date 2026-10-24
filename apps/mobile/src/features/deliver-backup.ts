export type DeliveryResult = 'shared' | 'downloaded' | 'cancelled';

interface ShareNavigator {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
}

interface DeliveryEnv {
  nav?: ShareNavigator;
  doc?: Pick<Document, 'createElement'> & { body: Pick<HTMLElement, 'append'> };
  url?: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
}

function download(backup: { text: string; fileName: string }, doc: NonNullable<DeliveryEnv['doc']>, url: NonNullable<DeliveryEnv['url']>) {
  const href = url.createObjectURL(new Blob([backup.text], { type: 'application/json' }));
  const link = doc.createElement('a');
  link.href = href;
  link.download = backup.fileName;
  doc.body.append(link);
  link.click();
  link.remove();
  url.revokeObjectURL(href);
}

/**
 * Entrega el archivo de la copia: primero con la hoja de compartir del teléfono (WhatsApp, Drive, correo);
 * si no se puede compartir un archivo, lo descarga. Si la persona cierra la hoja, no cuenta como copia hecha.
 */
export async function deliverBackup(
  backup: { text: string; fileName: string },
  env: DeliveryEnv = {
    nav: typeof navigator === 'undefined' ? undefined : navigator,
    doc: typeof document === 'undefined' ? undefined : document,
    url: typeof URL === 'undefined' ? undefined : URL,
  },
): Promise<DeliveryResult> {
  const { nav, doc, url } = env;
  const file = new File([backup.text], backup.fileName, { type: 'application/json' });
  const data: ShareData = { files: [file], title: 'Copia de seguridad de Mis Finanzas', text: 'Mi copia de seguridad de Mis Finanzas' };

  if (nav?.share && nav.canShare?.(data)) {
    try {
      await nav.share(data);
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
      // Cualquier otro fallo: se intenta la descarga normal.
    }
  }
  if (!doc || !url) throw new Error('No se pudo guardar el archivo en este navegador.');
  download(backup, doc, url);
  return 'downloaded';
}
