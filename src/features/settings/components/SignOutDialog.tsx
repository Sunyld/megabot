import { useState } from 'react';

import { Dialog } from '@/components/ui/Dialog';
import { useSession } from '@/features/auth/session';

export function SignOutDialog({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { signOut } = useSession();
  const [loading, setLoading] = useState(false);

  const confirm = async () => {
    setLoading(true);
    try {
      await signOut();
    } finally {
      setLoading(false);
      onClose();
    }
  };

  return (
    <Dialog
      visible={visible}
      onClose={onClose}
      icon="logout"
      tone="danger"
      title="Terminar sessão?"
      message="A automação continua a funcionar nos seus dispositivos. Pode voltar a entrar a qualquer momento."
      confirmLabel="Terminar sessão"
      confirmVariant="danger"
      loading={loading}
      onConfirm={confirm}
    />
  );
}
