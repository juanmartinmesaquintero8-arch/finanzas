type PersistApi = Pick<StorageManager, 'persist' | 'persisted'>;

/**
 * Pide al navegador que NO borre los datos de la app cuando falte espacio en el teléfono.
 * Devuelve si quedó protegido; nunca lanza (si no hay soporte, simplemente sigue).
 */
export async function requestPersistentStorage(storage: PersistApi | undefined): Promise<boolean> {
  if (!storage?.persist) return false;
  try {
    if (await storage.persisted?.()) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}
