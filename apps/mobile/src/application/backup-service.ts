import type { ActionResult } from '@finanzas/ui';
import type { LedgerSnapshot } from '@/data/idb-ledger-store';
import { backupFileName, isBackupReminderDue, serializeBackup } from './backup';
import { writeAction, type ServiceContext } from './support';

const LAST_BACKUP_KEY = 'lastBackupAt';

export interface CreatedBackup {
  text: string;
  fileName: string;
  exportedAt: string;
}

export class BackupService {
  constructor(private readonly ctx: ServiceContext) {}

  /** Arma el archivo de la copia. No la da por hecha hasta que se confirme con `markDone`. */
  async create(): Promise<CreatedBackup> {
    const now = this.ctx.now();
    const snapshot = await this.ctx.ledger.readAll();
    return { text: serializeBackup(snapshot, now), fileName: backupFileName(now), exportedAt: now.toISOString() };
  }

  /** Se llama cuando la persona ya compartió o descargó el archivo. */
  async markDone(at: string): Promise<void> {
    await this.ctx.ledger.setMeta(LAST_BACKUP_KEY, at);
    this.ctx.bus.emit();
  }

  async lastBackupAt(): Promise<string | null> {
    return (await this.ctx.ledger.getMeta<string>(LAST_BACKUP_KEY)) ?? null;
  }

  async reminderDue(): Promise<boolean> {
    const [lastBackupAt, accounts] = await Promise.all([this.lastBackupAt(), this.ctx.accounts.findAll()]);
    return isBackupReminderDue({ lastBackupAt, hasData: accounts.length > 0, now: this.ctx.now() });
  }

  /** Reemplaza TODOS los datos por los de la copia (ya validada con `parseBackup`). */
  restore(snapshot: LedgerSnapshot): Promise<ActionResult> {
    return writeAction(this.ctx, () => this.ctx.ledger.replaceAll(snapshot));
  }
}
