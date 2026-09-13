// SPDX-License-Identifier: Apache-2.0
import { Badge } from '@/components/ui';
import type { SessionRole } from '@/lib/types';

const VARIANT: Record<SessionRole, 'default' | 'secondary' | 'outline'> = {
  owner: 'default',
  editor: 'secondary',
  viewer: 'outline',
};

export function RoleBadge({ role }: { role: SessionRole }) {
  return (
    <Badge variant={VARIANT[role]} className="capitalize">
      {role}
    </Badge>
  );
}

export function RemoteBadge() {
  return (
    <Badge variant="warning" title="Executed on another device">
      REMOTE
    </Badge>
  );
}
