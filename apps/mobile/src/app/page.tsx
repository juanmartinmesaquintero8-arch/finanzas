import { Suspense } from 'react';
import { HomeScreen } from '@/features/HomeScreen';

export default function Page() {
  return (
    <Suspense fallback={null}>
      <HomeScreen />
    </Suspense>
  );
}
