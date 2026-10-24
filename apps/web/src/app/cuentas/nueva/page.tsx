import { NewAccountContainer } from '@/components/NewAccountContainer';
import { ui } from '@finanzas/ui';

export const metadata = { title: 'Nueva cuenta · Mis Finanzas' };

export default function NewAccountPage() {
  return (
    <>
      <h1 className={ui.pageTitle}>Nueva cuenta</h1>
      <NewAccountContainer />
    </>
  );
}
