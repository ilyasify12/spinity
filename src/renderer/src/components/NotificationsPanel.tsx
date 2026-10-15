import { useApp } from '../store/app'
import { useSocial } from '../store/social'
import { useUi } from '../store/ui'
import { useParty } from '../store/party'
import { t } from '../lib/i18n'
import { timeAgo, truncate } from '../lib/format'
import { IconDownload, IconChat, IconHeadphones, IconCheck } from './Icons'

interface PanelProps {
  onClose: () => void
  onOpenFriends: () => void
  onOpenDownloads: () => void
}

/** Download status → [i18n key, English fallback], resolved at render time. */
const STATUS_LABELS: Record<string, [string, string]> = {
  queued: ['dl.queued', 'Queued'],
  downloading: ['dl.downloading', 'Downloading'],
  converting: ['dl.converting', 'Converting audio'],
  done: ['dl.done', 'Done'],
  error: ['dl.failed', 'Failed'],
  canceled: ['dl.canceled', 'Cancelled']
}

/**
 * The bell dropdown: a real notification center. Downloads with live %,
 * unread messages (click jumps into the chat), and party invites
 * (join/dismiss inline). Empty sections are hidden; an empty feed says so.
 */
export function NotificationsPanel({ onClose, onOpenFriends, onOpenDownloads }: PanelProps): React.JSX.Element {
  const jobs = useApp((s) => s.jobs)
  const notify = useApp((s) => s.notify)
  const conversations = useSocial((s) => s.conversations)
  const friends = useSocial((s) => s.friends)
  const invites = useSocial((s) => s.partyInvites)
  const dismissInvite = useSocial((s) => s.dismissInvite)

  const activeJobs = jobs.filter((j) => j.status === 'queued' || j.status === 'downloading' || j.status === 'converting')
  const doneJobs = jobs
    .filter((j) => j.status === 'done')
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, 5)
  const unreadConvs = conversations
    .filter((c) => c.unread > 0)
    .sort((a, b) => (b.unread ?? 0) - (a.unread ?? 0))
    .slice(0, 8)

  const nameOf = (otherId: string): string =>
    friends.find((f) => f.id === otherId)?.displayName ?? t('ui.someone', 'Someone')

  async function joinInvite(code: string, fromId: string): Promise<void> {
    try {
      await useParty.getState().join(code)
      dismissInvite(code, fromId)
      onClose()
      notify(`${t('toast.joinedParty', 'Joined party ')}${code}${t('toast.joinedPartyTail', ' — music starts automatically')}`)
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  function openChat(conversationId: string): void {
    useUi.getState().requestChat(conversationId)
    onClose()
    onOpenFriends()
  }

  const empty = invites.length === 0 && unreadConvs.length === 0 && activeJobs.length === 0 && doneJobs.length === 0

  return (
    <div className="sp-notif-panel" role="menu" aria-label={t('ui.notifications', 'Notifications')}>
      <header className="sp-notif-head">
        <strong>{t('ui.notifications', 'Notifications')}</strong>
      </header>
      <div className="sp-notif-list">
        {empty && <p className="hint sp-notif-empty">{t('ui.allCaughtUp', 'All caught up — nothing new.')}</p>}

        {invites.length > 0 && (
          <section>
            <span className="fr-section-label sp-notif-label">{t('ui.partyInvites', 'Party invites')}</span>
            {invites.map((inv) => (
              <div key={`${inv.code}-${inv.fromId}`} className="sp-notif-row">
                <span className="sp-notif-icon invite"><IconHeadphones size={15} /></span>
                <span className="sp-notif-meta">
                  <span className="sp-notif-title">{inv.fromName} {t('ui.invitedYou', 'invited you')}</span>
                  <span className="hint">{t('ui.code', 'Code')} {inv.code} · {timeAgo(inv.at)}</span>
                </span>
                <button className="btn btn-sm" onClick={() => void joinInvite(inv.code, inv.fromId)}>{t('ui.join', 'Join')}</button>
                <button className="btn btn-ghost btn-sm" title={t('ui.dismiss', 'Dismiss')} onClick={() => dismissInvite(inv.code, inv.fromId)}>✕</button>
              </div>
            ))}
          </section>
        )}

        {unreadConvs.length > 0 && (
          <section>
            <span className="fr-section-label sp-notif-label">{t('ui.messages', 'Messages')}</span>
            {unreadConvs.map((c) => (
              <button key={c.id} className="sp-notif-row as-btn" onClick={() => openChat(c.id)}>
                <span className="sp-notif-icon msg"><IconChat size={15} /></span>
                <span className="sp-notif-meta">
                  <span className="sp-notif-title">
                    {nameOf(c.otherId)}
                    <span className="sp-notif-badge">{c.unread}</span>
                  </span>
                  <span className="hint">{truncate(c.lastMessagePreview ?? t('msg.newMessage', 'New message'), 60)}</span>
                </span>
              </button>
            ))}
          </section>
        )}

        {activeJobs.length > 0 && (
          <section>
            <span className="fr-section-label sp-notif-label">{t('ui.downloading', 'Downloading')}</span>
            {activeJobs.slice(0, 5).map((j) => (
              <button key={j.id} className="sp-notif-row as-btn" onClick={() => { onClose(); onOpenDownloads() }}>
                <span className="sp-notif-icon dl"><IconDownload size={15} /></span>
                <span className="sp-notif-meta">
                  <span className="sp-notif-title">{truncate(j.title, 48)}</span>
                  <span className="sp-notif-progress">
                    <span className="sp-notif-fill" style={{ width: `${Math.round(j.progress ?? 0)}%` }} />
                  </span>
                  <span className="hint">{STATUS_LABELS[j.status] ? t(STATUS_LABELS[j.status][0], STATUS_LABELS[j.status][1]) : j.status} · {Math.round(j.progress ?? 0)}%</span>
                </span>
              </button>
            ))}
          </section>
        )}

        {doneJobs.length > 0 && (
          <section>
            <span className="fr-section-label sp-notif-label">{t('ui.recentlyDownloaded', 'Recently downloaded')}</span>
            {doneJobs.map((j) => (
              <button key={j.id} className="sp-notif-row as-btn" onClick={() => { onClose(); onOpenDownloads() }}>
                <span className="sp-notif-icon done"><IconCheck size={15} /></span>
                <span className="sp-notif-meta">
                  <span className="sp-notif-title">{truncate(j.title, 48)}</span>
                  <span className="hint">{t('ui.downloadComplete', 'Download complete')}</span>
                </span>
              </button>
            ))}
          </section>
        )}
      </div>
      <footer className="sp-notif-foot">
        <button className="btn btn-ghost btn-sm" onClick={() => { onClose(); onOpenFriends() }}>{t('ui.openFriends', 'Open Friends')}</button>
        <button className="btn btn-ghost btn-sm" onClick={() => { onClose(); onOpenDownloads() }}>{t('ui.openDownloads', 'Open Downloads')}</button>
      </footer>
    </div>
  )
}
