import { useUi } from '@/stores/ui'
import { ProfileModal } from '@/features/profile/ProfileModal'
import { SettingsModal } from '@/features/settings/SettingsModal'
import { ChannelSettingsModal, CreateChannelModal } from '@/features/servers/ChannelModals'
import { CreateServerModal } from '@/features/servers/CreateServerModal'
import { InviteModal } from '@/features/servers/InviteModal'
import { ServerSettingsModal } from '@/features/servers/ServerSettingsModal'

export function ModalHost() {
  const modal = useUi((s) => s.modal)
  const close = useUi((s) => s.closeModal)
  if (!modal) return null
  switch (modal.kind) {
    case 'create-server':
      return <CreateServerModal onClose={close} />
    case 'invite':
      return <InviteModal serverId={modal.serverId} onClose={close} />
    case 'create-channel':
      return <CreateChannelModal serverId={modal.serverId} onClose={close} />
    case 'channel-settings':
      return <ChannelSettingsModal channelId={modal.channelId} onClose={close} />
    case 'server-settings':
      return <ServerSettingsModal serverId={modal.serverId} onClose={close} />
    case 'settings':
      return <SettingsModal initialTab={modal.tab} onClose={close} />
    case 'profile':
      return <ProfileModal userId={modal.userId} onClose={close} />
  }
}
