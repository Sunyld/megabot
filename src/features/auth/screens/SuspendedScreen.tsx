import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { errorMessage } from '@/services';

import { AuthScaffold } from '../components/AuthScaffold';
import { useSession } from '../session';

/**
 * Shown instead of the operations app when the tenant is suspended.
 * (The database will enforce suspension on domain tables in later migrations;
 * here the app simply never opens the dashboard for a suspended tenant.)
 */
export function SuspendedScreen() {
  const { session, reload, signOut } = useSession();
  const [checking, setChecking] = useState(false);

  const checkAgain = async () => {
    setChecking(true);
    try {
      await reload();
    } catch (e) {
      toast.error('Não foi possível verificar', errorMessage(e));
    } finally {
      setChecking(false);
    }
  };

  return (
    <AuthScaffold
      title="Empresa suspensa"
      description={`O acesso a ${session?.tenant?.name ?? 'esta empresa'} está temporariamente suspenso. Contacte o suporte do MegaBot para reativar a conta.`}
      footer={<Button label="Terminar sessão" variant="ghost" fullWidth disabled={checking} onPress={() => void signOut()} />}>
      <Button label="Verificar novamente" icon="refresh" size="lg" fullWidth loading={checking} onPress={() => void checkAgain()} />
    </AuthScaffold>
  );
}
