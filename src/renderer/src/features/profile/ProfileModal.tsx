import { Ban, MessageCircle, Phone, UserCheck, UserPlus } from 'lucide-react'
import { Avatar, colorFor, STATUS_LABEL, StatusDot } from '@/components/Avatar'
import { confirmDialog, Modal } from '@/components/Modal'
import { Button } from '@/components/ui'
import { useActions } from '@/data/actions'
import { useBlocks, useFriendships, useProfile } from '@/data/queries'
import { formatDay } from '@/lib/format'
import { useStatus } from '@/stores/presence'
import { useSession } from '@/stores/session'
import { useUi } from '@/stores/ui'
import { startCall } from '@/voice/call'

export function ProfileModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const me = useSession((s) => s.session?.user.id)
  const profile = useProfile(userId)
  const status = useStatus(userId)
  const { data: friendships = [] } = useFriendships()
  const { data: blocks = [] } = useBlocks()
  const actions = useActions()
  const openModal = useUi((s) => s.openModal)

  if (!profile) return null
  const isMe = userId === me
  const friendship = friendships.find((f) => f.requester_id === userId || f.addressee_id === userId)
  const blocked = blocks.some((b) => b.blocked_id === userId)
  const banner = colorFor(profile.display_name)

  return (
    <Modal title="" onClose={onClose} width="max-w-sm" bare>
      {/* Üst şerit kişinin avatar renginden türer; avatar şeridin üstüne biner. */}
      <div className="h-24" style={{ background: `linear-gradient(135deg, ${banner}, color-mix(in srgb, ${banner} 55%, black))` }} />
      <div className="px-5 pb-5">
        <div className="-mt-11 flex rounded-full">
          <span className="flex rounded-full ring-[5px] ring-elevated">
            <Avatar name={profile.display_name} path={profile.avatar_path} userId={userId} size={88} showStatus ringClass="ring-elevated" />
          </span>
        </div>
        <h2 className="selectable mt-3 text-xl leading-tight font-bold text-fg">{profile.display_name}</h2>
        <p className="selectable text-sm text-muted">@{profile.username}</p>

        <div className="mt-4 space-y-2.5 rounded-lg border border-line bg-sidebar p-3 text-sm">
          <p className="flex items-center gap-2 text-fg">
            <StatusDot status={status} />
            {STATUS_LABEL[status]}
          </p>
          {profile.custom_status && <p className="selectable break-words text-muted">{profile.custom_status}</p>}
          <p className="border-t border-line pt-2.5 text-xs text-faint">Üyelik: {formatDay(profile.created_at)}</p>
        </div>

        {isMe ? (
          <Button
            className="mt-4 w-full"
            onClick={() => {
              onClose()
              openModal({ kind: 'settings', tab: 'profile' })
            }}
          >
            Profilini düzenle
          </Button>
        ) : (
          <div className="mt-4 flex flex-wrap gap-2">
            {!blocked && (
              <Button
                onClick={async () => {
                  onClose()
                  await actions.openDm(userId)
                }}
              >
                <MessageCircle className="size-4" /> Mesaj
              </Button>
            )}
            {!blocked && (
              <Button
                variant="secondary"
                onClick={async () => {
                  onClose()
                  const channelId = await actions.openDm(userId).catch(() => null)
                  if (channelId) void startCall(channelId, userId)
                }}
              >
                <Phone className="size-4" /> Ara
              </Button>
            )}
            {!blocked && !friendship && (
              <Button variant="secondary" onClick={() => void actions.sendFriendRequest(profile.username)}>
                <UserPlus className="size-4" /> Arkadaş ekle
              </Button>
            )}
            {friendship?.status === 'accepted' && (
              <Button variant="secondary" disabled>
                <UserCheck className="size-4" /> Arkadaşsınız
              </Button>
            )}
            {friendship?.status === 'pending' && (
              <Button variant="secondary" disabled>
                İstek bekliyor
              </Button>
            )}
            {blocked ? (
              <Button variant="secondary" onClick={() => void actions.unblockUser(userId)}>
                Engeli kaldır
              </Button>
            ) : (
              <Button
                variant="danger"
                onClick={async () => {
                  if (
                    await confirmDialog({
                      title: 'Engelle',
                      text: `${profile.display_name} engellenirse arkadaşlığınız kalkar ve sana DM atamaz.`,
                      confirmLabel: 'Engelle',
                    })
                  )
                    void actions.blockUser(userId)
                }}
              >
                <Ban className="size-4" /> Engelle
              </Button>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
