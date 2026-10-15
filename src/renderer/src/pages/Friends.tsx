import { useEffect, useRef, useState } from 'react'
import { t } from '../lib/i18n'
import { useApp } from '../store/app'
import { useSocial } from '../store/social'
import { useUi } from '../store/ui'
import { useParty, friendlyPartyError } from '../store/party'
import { usePlayer } from '../player/engine'
import { playlistToSharePayload } from '@shared/social'
import { IconChat, IconPhone, IconPhoneOff, IconMic, IconMicOff, IconSend, IconUserPlus, IconCheck, IconX, IconCopy, IconBroadcast, IconHeadphones, IconSearch, IconChevronLeft, IconPlus } from '../components/Icons'
import { openContextMenu, type MenuItem } from '../components/ContextMenu'
import { endCall, handleSignal, setMuted, startCall, onMicLevel } from '../social/rtc'
import { startIncomingRing, startOutgoingRing, stopRingtone } from '../social/ringtone'
import { onPartyState, onPartyQueue } from '../player/partySync'

export function FriendsPage(): React.JSX.Element {
  const { tracks, playlists, notify } = { tracks: useApp(s => s.tracks), playlists: useApp(s => s.playlists), notify: useApp(s => s.notify) }
  const social = useSocial()
  const party = useParty()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<{ id: string; username: string; displayName: string; status?: string }[]>([])
  const [searching, setSearching] = useState(false)

  // chat
  const [activeConv, setActiveConv] = useState<string | null>(null)
  const [msgs, setMsgs] = useState<{ id: string; senderId: string; kind: string; body: string | null; payload: unknown; createdAt: string }[]>([])
  const [composer, setComposer] = useState('')
  const [sending, setSending] = useState(false)
  const [inviting, setInviting] = useState<string | null>(null)
  const [sharePick, setSharePick] = useState<string | null>(null)
  // images
  const [uploading, setUploading] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [deadImages, setDeadImages] = useState<Set<string>>(new Set())
  const filePickRef = useRef<HTMLInputElement>(null)

  // call
  const [callWith, setCallWith] = useState<string | null>(null)
  const [callWithName, setCallWithName] = useState('')
  const [callId, setCallId] = useState<string | null>(null)
  const [muted, setMutedState] = useState(false)
  const [micError, setMicError] = useState<string | null>(null)
  const [micLevel, setMicLevel] = useState(0)
  const [calling, setCalling] = useState(false)
  const [incomingCall, setIncomingCall] = useState<{ from: string; fromName: string; callId: string } | null>(null)

  // party UI
  const [partyBusy, setPartyBusy] = useState(false)
  const [showJoinInput, setShowJoinInput] = useState(false)
  // Stable snapshot for the socket listener so it subscribes exactly once
  // instead of re-subscribing on every conversation switch.
  const activeConvRef = useRef<string | null>(null)
  activeConvRef.current = activeConv

  // Chat auto-scroll: stick to the bottom on new messages, unless the user
  // scrolled up to read history (then leave them alone).
  const msgsScrollRef = useRef<HTMLDivElement>(null)
  const stickBottom = useRef(true)
  useEffect(() => {
    if (stickBottom.current) {
      const el = msgsScrollRef.current
      if (el) el.scrollTop = el.scrollHeight
    }
  }, [msgs, activeConv])

  function onMsgsScroll(): void {
    const el = msgsScrollRef.current
    if (!el) return
    stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  useEffect(() => { void social.refresh() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Report the open conversation to main (smart desktop toasts) + stop any
  // ringtone when leaving the page.
  useEffect(() => {
    const convId = social.conversations.some((c) => c.id === activeConv) ? activeConv : null
    void window.spinity.social.focus(convId).catch(() => {})
    return () => {
      void window.spinity.social.focus(null).catch(() => {})
      stopRingtone()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConv])

  // Mic level meter while on a call.
  useEffect(() => {
    if (!callWith) return
    const off = onMicLevel(setMicLevel)
    return off
  }, [callWith])

  // Party state lives in the store (survives page switches) and the sync
  // loop + member polling are owned by App — here we only restore after
  // connecting, since App's one-shot restore runs before login.
  useEffect(() => {
    if (!social.connected) return
    void party.restore()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [social.connected])

  useEffect(() => {
    const off = window.spinity.events.onSocial((evt) => {
      if (evt.type === 'call:incoming') {
        const p = evt.payload as { from: string; callId: string }
        const friend = useSocial.getState().friends.find(f => f.id === p.from)
        setIncomingCall({ from: p.from, fromName: friend?.displayName ?? p.from.slice(0, 8), callId: p.callId })
        startIncomingRing()
      } else if (evt.type === 'call:accepted' || evt.type === 'call:declined' || evt.type === 'call:ended') {
        stopRingtone()
        if (evt.type === 'call:ended') { endCall(); setCallWith(null); setCallId(null); setCalling(false) }
        if (evt.type === 'call:accepted') { setCalling(false); notify(t('fr.callAccepted', 'Call accepted — you should hear each other now')) }
        if (evt.type === 'call:declined') { notify(t('fr.callDeclined', 'Call declined'), 'error'); endCall(); setCallWith(null); setCallId(null); setCalling(false) }
      } else if (evt.type === 'call:signal') {
        const p = evt.payload as { signal: unknown }
        void handleSignal(p.signal).catch((e: unknown) => notify(e instanceof Error ? e.message : String(e), 'error'))
      } else if (evt.type === 'chat:message') {
        const m = evt.payload as { id: string; conversationId: string; senderId: string; kind: string; body: string | null; payload: unknown; createdAt: string }
        if (m.conversationId === activeConvRef.current) {
          // Already have it (optimistic echo)? Never duplicate, never refetch.
          setMsgs((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))
          void window.spinity.social.read(m.conversationId).catch(() => {})
          void useSocial.getState().refreshBadge()
        } else {
          // Another thread: just the badge, no full friends reload.
          void useSocial.getState().refreshBadge()
        }
      } else if (evt.type === 'chat:deleted') {
        const d = evt.payload as { conversationId: string; messageId: string }
        if (d.conversationId === activeConvRef.current) {
          setMsgs((prev) => prev.filter((x) => x.id !== d.messageId))
        }
      } else if (evt.type === 'party:state') {
        const p = evt.payload as { partyId: string; playback: { trackIndex: number; positionMs: number; isPlaying: boolean; updatedAt: string }; at: number }
        void onPartyState(p.partyId, p.playback, p.at)
      } else if (evt.type === 'party:queue') {
        const p = evt.payload as { partyId: string; queue: { videoId: string; title: string; artist: string; durationSec: number; thumbnail: string; webUrl: string }[] }
        onPartyQueue(p.partyId, p.queue)
      } else if (evt.type === 'party:members') {
        const p = evt.payload as { partyId: string; participants: string[] }
        useParty.getState().applyMembers(p.partyId, p.participants)
      } else if (evt.type === 'party:member-joined' || evt.type === 'party:member-left') {
        void useParty.getState().refreshMembers()
      } else if (evt.type === 'presence:update') {
        const p = evt.payload as { userId: string; status: string }
        useSocial.getState().setPresence(p.userId, p.status)
      } else if (evt.type === 'friend:request' || evt.type === 'friend:updated') {
        void social.refresh()
      }
    })
    return off
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function doSearch(): Promise<void> {
    const trimmed = q.trim()
    if (trimmed.length < 2) { setResults([]); return }
    setSearching(true)
    try { setResults(await social.search(trimmed)) } catch (err) { notify(err instanceof Error ? err.message : String(err), 'error') }
    finally { setSearching(false) }
  }

  async function loadMessages(convId: string): Promise<void> {
    try {
      const list = await window.spinity.social.messages(convId, 50)
      setMsgs(list as never)
      // Marking read doesn't change what we render — fire and forget.
      void window.spinity.social.read(convId).catch(() => {})
      void useSocial.getState().refreshBadge()
    } catch (err) { notify(err instanceof Error ? err.message : String(err), 'error') }
  }

  // Opened from a desktop-notification click: App stores the conversation id
  // in the ui store (it survives this lazy page mounting after the click).
  const pendingChatId = useUi((s) => s.pendingChatId)
  useEffect(() => {
    if (!pendingChatId) return
    useUi.getState().requestChat(null)
    stickBottom.current = true
    setActiveConv(pendingChatId)
    void loadMessages(pendingChatId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingChatId])

  /** Open (or create) the DM with a friend — used by the rail row and its button. */
  async function openChat(friendId: string): Promise<void> {
    stickBottom.current = true
    setActiveConv(friendId)
    const convs = await window.spinity.social.conversations().catch(() => [])
    const found = (convs as { id: string; otherId: string }[]).find(c => c.otherId === friendId)
    if (found) { setActiveConv(found.id); await loadMessages(found.id) } else setMsgs([])
  }

  /** 'HH:MM' for a message timestamp. */
  function msgTime(iso: string): string {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  async function sendMessage(): Promise<void> {
    const body = composer.trim()
    if (!body || !activeConv || sending) return
    const isConvId = /^[a-f0-9]{24}$/.test(activeConv) && social.conversations.some(c => c.id === activeConv)
    const target = isConvId ? { conversationId: activeConv } : { toUserId: activeConv }
    // Optimistic: paint the row and clear the box instantly — the server
    // round-trip happens in the background instead of blocking the UI.
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const meId = useSocial.getState().me?.id ?? 'me'
    setMsgs((prev) => [...prev, { id: tempId, senderId: meId, kind: 'text', body, payload: null, createdAt: new Date().toISOString() }])
    setComposer('')
    setSending(true)
    try {
      const ack = await window.spinity.social.send({ ...target, kind: 'text', body }) as { id: string; conversationId: string }
      // Swap the temp row for the real id, then a single refresh of this thread.
      setMsgs((prev) => prev.map((m) => (m.id === tempId ? { ...m, id: ack.id } : m)))
      const convId = ack.conversationId || activeConv
      if (!isConvId && convId !== activeConv) setActiveConv(convId)
      await loadMessages(convId)
    } catch (err) {
      // Roll back: drop the optimistic row and restore the text.
      setMsgs((prev) => prev.filter((m) => m.id !== tempId))
      setComposer(body)
      notify(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setSending(false)
    }
  }

  /** Delete one of my messages (sender-only, synced to the other side). */
  async function deleteMessage(messageId: string): Promise<void> {
    const backup = msgs
    setMsgs((prev) => prev.filter((m) => m.id !== messageId))
    try {
      await window.spinity.social.deleteMessage(messageId)
    } catch (err) {
      setMsgs(backup)
      notify(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  /** 'in 2d 5h' / 'in 40m' / 'expired' for an image expiry timestamp. */
  function imgExpiry(expiresAt: string | null | undefined, pinned?: boolean): string {
    if (pinned) return t('msg.pinnedKeep', '📌 Pinned — kept forever')
    if (!expiresAt) return ''
    const left = new Date(expiresAt).getTime() - Date.now()
    if (left <= 0) return t('msg.expired', 'Expired')
    const autoIn = t('msg.autoDeleteIn', 'Auto-deletes in ')
    const h = Math.floor(left / 3600000)
    if (h >= 48) return `${autoIn}${Math.floor(h / 24)}d`
    if (h >= 1) return `${autoIn}${h}h`
    return `${autoIn}${Math.max(1, Math.floor(left / 60000))}m`
  }

  /** Pick → validate → upload → send. 5 MB max, auto-deletes in 3 days unless pinned. */
  async function sendImageFile(file: File): Promise<void> {
    if (!activeConv) return
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) {
      notify(t('fr.badImageType', 'Send a PNG, JPG, GIF or WebP image'), 'error')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      notify(t('fr.imageTooBig', 'Image is too big (max 5 MB)'), 'error')
      return
    }
    const isConvId = /^[a-f0-9]{24}$/.test(activeConv) && social.conversations.some((c) => c.id === activeConv)
    const target = isConvId ? { conversationId: activeConv } : { toUserId: activeConv }
    const localUrl = URL.createObjectURL(file)
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const meId = useSocial.getState().me?.id ?? 'me'
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.onerror = () => reject(new Error(t('fr.couldNotReadFile', 'Could not read that file')))
      r.readAsDataURL(file)
    }).catch((err: unknown) => {
      URL.revokeObjectURL(localUrl)
      notify(err instanceof Error ? err.message : String(err), 'error')
      return null
    })
    if (!dataUrl) return
    setUploading(true)
    setMsgs((prev) => [...prev, { id: tempId, senderId: meId, kind: 'image', body: null, payload: { localUrl, pending: true }, createdAt: new Date().toISOString() }])
    try {
      const up = await window.spinity.images.send({ ...target, dataUrl })
      const ack = await window.spinity.social.send({
        conversationId: up.conversationId, kind: 'image',
        payload: { imageId: up.imageId, expiresAt: up.expiresAt, pinned: false }
      }) as { id: string; conversationId: string }
      URL.revokeObjectURL(localUrl)
      setMsgs((prev) => prev.map((m) => (m.id === tempId
        ? { ...m, id: ack.id, payload: { imageId: up.imageId, expiresAt: up.expiresAt, pinned: false } }
        : m)))
      const convId = ack.conversationId || activeConv
      if (!isConvId && convId !== activeConv) setActiveConv(convId)
      await loadMessages(convId)
    } catch (err) {
      URL.revokeObjectURL(localUrl)
      setMsgs((prev) => prev.filter((m) => m.id !== tempId))
      notify(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setUploading(false)
    }
  }

  /** Pin/unpin a chat image (pinned images skip the 3-day auto-delete). */
  async function togglePin(messageId: string, imageId: string, pinned: boolean): Promise<void> {
    try {
      const r = await window.spinity.images.pin(imageId, !pinned)
      setMsgs((prev) => prev.map((m) => {
        const p = m.payload as { imageId?: string } | null
        if (m.id !== messageId || p?.imageId !== imageId) return m
        return { ...m, payload: { ...(p as object), pinned: r.pinned, expiresAt: r.expiresAt } }
      }))
      notify(r.pinned ? t('fr.pinned', '📌 Pinned — this photo is kept forever') : t('fr.unpinned', 'Pin removed — auto-delete re-armed'))
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'error')
    }
  }
  /** Invite a friend to the current listening party via chat DM. */
  async function sendPartyInvite(friendId: string): Promise<void> {
    const code = useParty.getState().code.trim().toUpperCase()
    if (!code || !party.partyId) { notify(t('fr.partyFirst', 'Create or join a party first'), 'error'); return }
    setInviting(friendId)
    try {
      const body = `🎵 ${t('msg.partyInviteBody', 'Join my listening party! Code:')} ${code}`
      const conv = social.conversations.find((c) => c.otherId === friendId)
      if (conv) await window.spinity.social.send({ conversationId: conv.id, kind: 'text', body, payload: { partyCode: code } })
      else await window.spinity.social.send({ toUserId: friendId, kind: 'text', body, payload: { partyCode: code } })
      notify(`${t('fr.inviteSent', 'Party invite sent')} (${code})`)
    } catch (err) { notify(err instanceof Error ? err.message : String(err), 'error') }
    finally { setInviting(null) }
  }

  async function sendPlaylist(playlistId: string): Promise<void> {
    const pl = playlists.find(p => p.id === playlistId)
    if (!pl || !activeConv) return
    const trackObjs = pl.trackIds.map(id => tracks.find(t => t.id === id)).filter(Boolean) as { id: string; title: string; artist: string; durationSec: number; thumbnail: string; webUrl: string }[]
    const shareable = trackObjs.filter(t => !!t.webUrl)
    if (!shareable.length) { notify(t('fr.noShareable', 'That playlist has no shareable links (local-only files)'), 'error'); return }
    const payload = playlistToSharePayload(pl.name, shareable)
    const isConvId = social.conversations.some(c => c.id === activeConv)
    try {
      if (isConvId) await window.spinity.social.send({ conversationId: activeConv, kind: 'playlist', payload: payload as unknown })
      else await window.spinity.social.send({ toUserId: activeConv, kind: 'playlist', payload: payload as unknown })
      setSharePick(null)
      notify(`${t('fr.sharedPlaylist', 'Shared playlist')} "${pl.name}"`)
      if (isConvId) await loadMessages(activeConv)
    } catch (err) { notify(err instanceof Error ? err.message : String(err), 'error') }
  }

  async function inviteCall(friendId: string): Promise<void> {
    const friend = social.friends.find(f => f.id === friendId)
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setMicError(null)
    setCalling(true)
    setCallWith(friendId)
    setCallWithName(friend?.displayName ?? friendId.slice(0, 8))
    setCallId(id)
    ;(globalThis as unknown as { __spinitySendAnswer?: (sdp: string) => void }).__spinitySendAnswer = (sdp) => {
      void window.spinity.social.callSignal(friendId, id, { type: 'answer', sdp })
    }
    try {
      await window.spinity.social.callInvite(friendId, id)
      await startCall(friendId, id, true)
      setCalling(false)
      // Ring until they pick up, decline, or something errors.
      startOutgoingRing()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setMicError(msg)
      notify(msg, 'error')
      setCalling(false)
      stopRingtone()
    }
  }

  async function acceptCall(): Promise<void> {
    if (!incomingCall) return
    const p = incomingCall
    setIncomingCall(null)
    stopRingtone()
    setMicError(null)
    setCallWith(p.from)
    setCallWithName(p.fromName)
    setCallId(p.callId)
    ;(globalThis as unknown as { __spinitySendAnswer?: (sdp: string) => void }).__spinitySendAnswer = (sdp) => {
      void window.spinity.social.callSignal(p.from, p.callId, { type: 'answer', sdp })
    }
    try {
      await window.spinity.social.callAccept(p.from, p.callId)
      await startCall(p.from, p.callId, false)
      notify(t('fr.callConnected', 'Call connected'))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setMicError(msg)
      notify(msg, 'error')
      endCall(); setCallWith(null); setCallId(null)
    }
  }

  async function declineCall(): Promise<void> {
    if (!incomingCall) return
    stopRingtone()
    await window.spinity.social.callDecline(incomingCall.from, incomingCall.callId)
    setIncomingCall(null)
  }

  function hangUp(): void {
    stopRingtone()
    if (callWith && callId) void window.spinity.social.callEnd(callWith, callId)
    endCall(); setCallWith(null); setCallId(null); setCalling(false)
  }

  async function testMic(): Promise<void> {
    setMicError(null)
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true })
      s.getTracks().forEach(t => t.stop())
      notify(t('fr.micWorks', 'Microphone works — Spinity can hear you'))
    } catch (err) {
      const name = (err as { name?: string })?.name
      const msg = name === 'NotAllowedError'
        ? t('fr.micBlocked', 'Mic blocked by browser/Windows. Allow it in Windows Settings → Privacy → Microphone, then press Test again.')
        : name === 'NotFoundError' ? t('fr.micNotFound', 'No microphone found — plug one in.') : `${t('fr.micError', 'Mic error:')} ${err instanceof Error ? err.message : String(err)}`
      setMicError(msg)
      notify(msg, 'error')
    }
  }

  // ---- party actions ----
  async function createParty(): Promise<void> {
    setPartyBusy(true)
    try {
      // Use the local player's queue if there is one, else first playlist, else empty.
      // Only tracks with a shareable webUrl can be sent — local-only files have
      // no URL for guests to stream, and the server rejects them (webUrl required).
      const player = usePlayer.getState()
      const toShareable = (t: { id: string; title: string; artist: string; durationSec: number; thumbnail: string; webUrl: string }): { videoId: string; title: string; artist: string; durationSec: number; thumbnail: string; webUrl: string } | null =>
        t.webUrl ? { videoId: t.id, title: t.title, artist: t.artist, durationSec: t.durationSec, thumbnail: t.thumbnail, webUrl: t.webUrl } : null
      let queue = player.queue.slice(0, 100).map(toShareable).filter((t): t is NonNullable<typeof t> => t !== null)
      if (queue.length === 0 && playlists.length > 0) {
        const pl = playlists[0]
        queue = pl.trackIds.map(id => tracks.find(t => t.id === id)).filter(Boolean).map(t => toShareable(t!)).filter((t): t is NonNullable<typeof t> => t !== null)
      }
      if (queue.length === 0 && player.queue.length > 0) {
        notify(t('fr.localOnlyParty', 'Your music is local-only files — guests have no URL to stream them. Party created empty: play a YouTube track so guests can hear it.'), 'error')
      }
      await party.create(queue)
      notify(`${t('fr.partyCreatedHead', 'Party ')}${useParty.getState().code}${t('fr.partyCreatedTail', ' created — share the code. You are the host: what you play, guests hear.')}`)
      // Host pushes current state immediately.
      const st = useParty.getState()
      if (st.partyId) {
        const p = usePlayer.getState()
        await window.spinity.social.partySync(st.partyId, { trackIndex: Math.max(0, p.index), positionMs: Math.round(p.currentTime * 1000), isPlaying: p.playing }).catch(() => {})
        if (queue.length) await window.spinity.social.partyQueue(st.partyId, queue).catch(() => {})
      }
    } catch (err) { notify(friendlyPartyError(err), 'error') }
    finally { setPartyBusy(false) }
  }

  async function joinParty(): Promise<void> {
    const code = party.code.trim()
    if (!code) { notify(t('fr.enterCode', 'Enter a party code'), 'error'); return }
    setPartyBusy(true)
    try {
      await party.join(code)
      notify(`${t('fr.joinedHead', 'Joined party ')}${code}${t('fr.joinedTail', '. Music starts automatically — make sure your volume is up.')}`)
    } catch (err) { notify(friendlyPartyError(err), 'error') }
    finally { setPartyBusy(false) }
  }

  const partyTrack = party.playback ? (party.queue[party.playback.trackIndex] ?? party.queue[0] ?? null) : (party.queue[0] ?? null)
  const onlineCount = social.friends.filter(f => f.status === 'online').length
  // Header shows who you're talking to (conversation → friend lookup).
  const activeConvView = social.conversations.find((c) => c.id === activeConv) ?? null
  const activeFriend = activeConvView
    ? (social.friends.find((f) => f.id === activeConvView.otherId) ?? null)
    : (social.friends.find((f) => f.id === activeConv) ?? null)
  const unreadByOther = new Map(social.conversations.map((c) => [c.otherId, c.unread ?? 0]))

  return (
    <div className="friends-page connected">
      {!social.connected ? (
        <div className="fr-offline">
          <span className="presence-dot offline" />
          <span className="hint">
            {social.error
              ? `${t('fr.couldntReach', "Couldn't reach Spinity online — ")}${social.error}`
              : t('fr.connecting', 'Connecting to Spinity online…')}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => void social.refresh()}>{t('fr.retry', 'Retry')}</button>
        </div>
      ) : null}
      <div className={`fr-shell${activeConv ? ' chatting' : ' idle'}`}>
        <aside className="fr-rail">
          <div className="friends-search">
            <div className="search-row">
              <span className="search-icon"><IconSearch size={16} /></span>
              <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && void doSearch()} placeholder={t('fr.searchPlaceholder', 'Search by username or display name (min 2 chars)')} />
              <button className="btn btn-sm" onClick={() => void doSearch()} disabled={searching}>{searching ? '…' : t('nav.search', 'Search')}</button>
            </div>
            {results.length > 0 && (
              <div className="search-results">
                {results.map(u => (
                  <div key={u.id} className="friend-row">
                    <span className="avatar sm">{u.displayName.slice(0, 1).toUpperCase()}</span>
                    <span className="friend-name">{u.displayName} <span className="hint">@{u.username}</span></span>
                    <button className="btn btn-sm" onClick={() => void social.request(u.id).then(() => notify(`${t('fr.requestSent', 'Request sent to ')}${u.displayName}`)).catch(e => notify(String(e), 'error'))}><IconUserPlus size={14} /> {t('fr.add', 'Add')}</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {(social.incoming.length > 0 || social.outgoing.length > 0) && (
            <div className="friends-requests">
              {social.incoming.length > 0 && <><h3>{t('fr.requests', 'Requests')}</h3>{social.incoming.map(r => (
                <div key={r.id} className="friend-row">
                  <span>{r.from.displayName} @{r.from.username}</span>
                  <button className="btn btn-sm" onClick={() => void social.respond(r.id, true)}><IconCheck size={12} /> {t('fr.accept', 'Accept')}</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => void social.respond(r.id, false)}><IconX size={12} /> {t('fr.decline', 'Decline')}</button>
                </div>
              ))}</>}
              {social.outgoing.length > 0 && <div className="hint">{t('fr.outgoing', 'Outgoing:')} {social.outgoing.length} {t('fr.pending', 'pending')}</div>}
            </div>
          )}

          <div className="friends-list">
            <h3>{t('nav.friends', 'Friends')} ({social.friends.length}) · {onlineCount} {t('fr.online', 'online')}</h3>
            {social.friends.length === 0 && <p className="hint">{t('fr.noFriends', 'No friends yet — search above to add someone.')}</p>}
            {social.friends.map(f => (
              <div
                key={f.id}
                className={`friend-row${activeConv === f.id ? ' active' : ''}${(unreadByOther.get(f.id) ?? 0) > 0 ? ' has-unread' : ''}`}
                onClick={() => void openChat(f.id)}
                role="button"
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void openChat(f.id) } }}
                onContextMenu={(e) => {
                  const items: MenuItem[] = [
                    { label: t('fr.chat', 'Chat'), onSelect: () => void openChat(f.id) },
                    { label: t('fr.voiceCall', 'Voice call'), onSelect: () => void inviteCall(f.id) },
                    { label: t('fr.copyUsername', 'Copy username'), onSelect: () => void navigator.clipboard.writeText(`@${f.username}`).then(() => notify(t('action.copied', 'Copied'))).catch(() => {}) },
                    ...(party.partyId
                      ? [{ label: `${t('fr.inviteToParty', 'Invite to party')} ${party.code}`, onSelect: () => void sendPartyInvite(f.id) } as MenuItem]
                      : []),
                    {
                      label: t('fr.removeFriend', 'Remove friend'), danger: true, onSelect: () => {
                        void social.remove(f.id).then(() => notify(`${t('fr.removed', 'Removed ')}${f.displayName}`)).catch((err: unknown) => notify(err instanceof Error ? err.message : String(err), 'error'))
                      }
                    }
                  ]
                  openContextMenu(e, items)
                }}
              >
                <span className={`presence-dot ${f.status ?? 'offline'}`} title={t(`fr.status.${f.status ?? 'offline'}`, f.status ?? 'offline')} />
                <span className="avatar sm">{f.displayName.slice(0, 1).toUpperCase()}</span>
                <span className="friend-name">{f.displayName} <span className="hint">@{f.username} · {t(`fr.status.${f.status ?? 'offline'}`, f.status ?? 'offline')}</span></span>
                {(unreadByOther.get(f.id) ?? 0) > 0 && <span className="sp-notif-badge">{unreadByOther.get(f.id)}</span>}
                <button className="btn btn-ghost btn-sm" title={t('fr.chat', 'Chat')} onClick={e => { e.stopPropagation(); void openChat(f.id) }}><IconChat size={15} /></button>
                <button className="btn btn-ghost btn-sm" title={t('fr.voiceCall', 'Voice call')} onClick={e => { e.stopPropagation(); void inviteCall(f.id) }}><IconPhone size={15} /></button>
              </div>
            ))}
          </div>
          <div className="fr-rail-foot">
            <span className={`presence-dot ${social.connected ? (social.ownStatus === 'dnd' ? 'dnd' : social.ownStatus === 'invisible' ? 'offline' : 'online') : 'offline'}`} />
            <span className="hint"><strong>{social.me?.displayName ?? social.me?.username ?? '…'}</strong></span>
            <span style={{ flex: 1 }} />
            <select
              className="fr-status-select"
              value={social.ownStatus}
              title={t('fr.yourStatusLive', 'Your status — friends see it live')}
              aria-label={t('fr.yourStatus', 'Your status')}
              disabled={!social.connected}
              onChange={(e) => {
                const next = e.target.value as 'online' | 'dnd' | 'invisible'
                void social.setOwnStatus(next).catch((err: unknown) => notify(err instanceof Error ? err.message : String(err), 'error'))
              }}
            >
              <option value="online">{t('fr.status.online', 'Online')}</option>
              <option value="dnd">{t('fr.status.dnd', 'Do not disturb')}</option>
              <option value="invisible">{t('fr.status.invisible', 'Invisible')}</option>
            </select>
          </div>
        </aside>

        {!activeConv && (
          <div className="fr-empty">
            <span className="fr-empty-icon"><IconChat size={30} /></span>
            <strong>{t('fr.noConversation', 'No conversation selected')}</strong>
            <span className="hint">{t('fr.pickFriend', 'Pick a friend on the left to chat, call or share a playlist.')}</span>
          </div>
        )}

        {activeConv && (
            <div className="chat-panel">
              <div className="chat-header">
                <button className="chat-back" title={t('fr.backToFriends', 'Back to friends')} aria-label={t('fr.backToFriends', 'Back to friends')} onClick={() => setActiveConv(null)}>
                  <IconChevronLeft size={16} />
                </button>
                <span className={`presence-dot ${activeFriend?.status ?? 'offline'}`} title={t(`fr.status.${activeFriend?.status ?? 'offline'}`, activeFriend?.status ?? 'offline')} />
                <span className="avatar sm">{(activeFriend?.displayName ?? '?').slice(0, 1).toUpperCase()}</span>
                <span className="chat-title">
                  {activeFriend?.displayName ?? t('fr.chat', 'Chat')}
                  {activeFriend && <span className="hint"> @{activeFriend.username}</span>}
                </span>
                <span style={{ flex: 1 }} />
                <button className="btn btn-ghost btn-sm" onClick={() => setSharePick(sharePick ? null : 'pick')}><IconBroadcast size={13} /> {t('fr.share', 'Share')}</button>
                <button className="btn btn-ghost btn-sm" title={t('fr.closeChat', 'Close chat')} onClick={() => setActiveConv(null)}><IconX size={12} /></button>
              </div>
              {sharePick && (
                <div className="share-picker">
                  {playlists.length === 0 && <span className="hint">{t('ui.noPlaylistsYet', 'No playlists yet')}</span>}
                  {playlists.map(p => (
                    <button key={p.id} className="btn btn-sm" onClick={() => void sendPlaylist(p.id)}>{p.name} ({p.trackIds.length})</button>
                  ))}
                </div>
              )}
              <div className="chat-messages" ref={msgsScrollRef} onScroll={onMsgsScroll}>
                {msgs.length === 0 && <p className="hint" style={{ textAlign: 'center' }}>{t('fr.noMessagesYet', 'No messages yet — say hi 👋')}</p>}
                {msgs.map(m => (
                  <div
                    key={m.id}
                    className={`chat-msg ${m.senderId === social.me?.id ? 'own' : ''}`}
                    onContextMenu={(e) => {
                      const own = m.senderId === social.me?.id && !m.id.startsWith('temp-')
                      const img = m.payload as { imageId?: string; pinned?: boolean } | null
                      const items: MenuItem[] = [
                        ...(m.body
                          ? [{ label: t('fr.copyText', 'Copy text'), onSelect: () => void navigator.clipboard.writeText(m.body as string).then(() => notify(t('action.copied', 'Copied'))).catch(() => {}) } as MenuItem]
                          : []),
                        ...(m.kind === 'image' && img?.imageId
                          ? [
                            { label: img.pinned ? t('fr.unpinImage', 'Unpin image') : t('fr.pinImage', 'Pin image (keep forever)'), onSelect: () => void togglePin(m.id, img.imageId as string, !!img.pinned) } as MenuItem,
                            { label: t('fr.saveImage', 'Save image…'), onSelect: () => void window.spinity.images.save(img.imageId as string).then((p) => { if (p) notify(`${t('toast.savedTo', 'Saved to')} ${p}`) }).catch((err: unknown) => notify(err instanceof Error ? err.message : String(err), 'error')) } as MenuItem
                          ]
                          : []),
                        ...(own
                          ? [{ label: t('fr.deleteMessage', 'Delete message'), danger: true, onSelect: () => void deleteMessage(m.id) } as MenuItem]
                          : [])
                      ]
                      openContextMenu(e, items)
                    }}
                  >
                    {m.kind === 'image' ? (
                      (() => {
                        const p = m.payload as { imageId?: string; localUrl?: string; expiresAt?: string | null; pinned?: boolean; pending?: boolean } | null
                        const src = p?.localUrl ?? (p?.imageId ? `spinity://image/${p.imageId}` : null)
                        if (!src || deadImages.has(m.id)) {
                          return <span className="hint">📷 {deadImages.has(m.id) ? t('fr.photoExpired', 'Photo expired (auto-deleted)') : t('fr.loadingPhoto', 'Loading photo…')}</span>
                        }
                        return (
                          <span className="chat-photo">
                            <img
                              src={src}
                              alt={t('fr.sharedPhoto', 'Shared photo')}
                              loading="lazy"
                              onClick={() => { if (p?.imageId) setLightbox(p.imageId) }}
                              onError={() => setDeadImages((prev) => new Set(prev).add(m.id))}
                            />
                            <span className="chat-time static">{p?.pending ? t('fr.uploading', 'Uploading…') : imgExpiry(p?.expiresAt, p?.pinned)}</span>
                          </span>
                        )
                      })()
                    ) : m.kind === 'text' && (m.payload as { partyCode?: string } | null)?.partyCode ? (
                      <span className="chat-share">🎵 <strong>{t('fr.partyInviteTitle', 'Listening party invite')}</strong> — {t('ui.code', 'Code')} {(m.payload as { partyCode: string }).partyCode}
                        <button className="btn btn-sm" style={{ marginLeft: 8 }} onClick={() => {
                          const code = (m.payload as { partyCode: string }).partyCode
                          party.setCodeInput(code)
                          notify(t('toast.partyCodeFilled', `Party code ${code} filled in below — press Join`))
                        }}><IconHeadphones size={12} /> {t('fr.join', 'Join')}</button>
                      </span>
                    ) : m.kind === 'text' ? <span>{m.body}</span> : (
                      <span className="chat-share">🎵 {(m.payload as { name?: string })?.name ?? t('lib.playlist', 'Playlist')} — {(m.payload as { tracks?: unknown[] })?.tracks?.length ?? 0} {t('lib.tracks', 'tracks')}
                        <button className="btn btn-sm" style={{ marginLeft: 8 }} onClick={() => {
                          const tracksToAdd = (m.payload as { tracks?: { videoId: string; title: string; artist: string; durationSec: number; thumbnail: string; webUrl: string }[] })?.tracks ?? []
                          for (const t of tracksToAdd) void window.spinity.downloads.start({ id: t.videoId, source: 'youtube', title: t.title, artist: t.artist, durationSec: t.durationSec, thumbnail: t.thumbnail, webUrl: t.webUrl }).catch(() => {})
                          notify(`${t('toast.queuedTracks', 'Queued')} ${tracksToAdd.length} ${t('lib.tracks', 'tracks')}`)
                        }}><IconHeadphones size={12} /> {t('fr.addAll', 'Add all')}</button>
                      </span>
                    )}
                    <span className="chat-time">{msgTime(m.createdAt)}</span>
                  </div>
                ))}
              </div>
              <div className="chat-composer">
                <input
                  ref={filePickRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    e.target.value = ''
                    if (f) void sendImageFile(f)
                  }}
                  aria-label={t('fr.attachPhoto', 'Attach a photo')}
                />
                <button className="btn btn-ghost btn-sm" title={t('fr.sendPhotoHint', 'Send a photo (max 5 MB, auto-deletes in 3 days unless pinned)')} onClick={() => filePickRef.current?.click()} disabled={uploading}>
                  {uploading ? '…' : <IconPlus size={15} />}
                </button>
                <input value={composer} onChange={e => setComposer(e.target.value)} onKeyDown={e => e.key === 'Enter' && void sendMessage()} placeholder={`${t('fr.messageTo', 'Message')} ${activeFriend?.displayName ?? ''}…`} />
                <button className="btn btn-sm" onClick={() => void sendMessage()} disabled={sending || !composer.trim()} title={t('fr.send', 'Send')}><IconSend size={14} /></button>
              </div>
              {lightbox && (
                <div className="chat-lightbox" onClick={() => setLightbox(null)} role="dialog" aria-label={t('fr.photoViewer', 'Photo viewer')}>
                  <img src={`spinity://image/${lightbox}`} alt={t('fr.sharedPhoto', 'Shared photo')} onClick={(e) => e.stopPropagation()} />
                  <button className="btn btn-sm" onClick={() => setLightbox(null)}>{t('action.close', 'Close')}</button>
                </div>
              )}
            </div>
          )}

          <aside className="fr-side">
          {/* Active call controls sit on top while talking. */}
          {callWith && (
            <section className="fr-card call-box">
              <header className="fr-card-head">
                <span className="fr-card-title"><IconPhone size={14} /> {t('fr.voice', 'Voice')}</span>
                <span className="chip chip-ok">{calling ? t('fr.ringing', 'ringing…') : t('fr.onCall', 'on call')}</span>
              </header>
              <div className="fr-card-body">
                <div className="fr-row fr-row-between">
                  <strong>{calling ? `${t('fr.ringingLabel', 'Ringing ')}${callWithName}…` : callWithName}</strong>
                  <button className="btn btn-ghost btn-sm" title={t('fr.endCall', 'End call')} onClick={hangUp}><IconPhoneOff size={14} /> {t('fr.end', 'End')}</button>
                </div>
                <div className="fr-row">
                  <button className="btn btn-ghost btn-sm" onClick={() => { const n = !muted; setMutedState(n); setMuted(n) }}>{muted ? <IconMicOff size={14} /> : <IconMic size={14} />} {muted ? t('player.unmute', 'Unmute') : t('player.mute', 'Mute')}</button>
                  <div className="mic-meter" title={t('fr.micLevel', 'Mic level')}><div className="mic-fill" style={{ width: `${Math.round(micLevel * 100)}%` }} /></div>
                  <button className="btn btn-ghost btn-sm" title={t('fr.checkMic', 'Check microphone')} onClick={() => void testMic()}><IconMic size={13} /> {t('fr.test', 'Test')}</button>
                </div>
                {micError && <p className="error-text">{micError}</p>}
              </div>
            </section>
          )}

          {activeFriend ? (
            <section className="fr-card fr-profile">
              <div className="fr-profile-banner" />
              <div className="fr-card-body fr-profile-body">
                <span className="avatar xl">{activeFriend.displayName.slice(0, 1).toUpperCase()}</span>
                <strong className="fr-profile-name">{activeFriend.displayName}</strong>
                <span className="hint">@{activeFriend.username} · {t(`fr.status.${activeFriend.status ?? 'offline'}`, activeFriend.status ?? 'offline')}</span>
                <div className="fr-row">
                  <button className="btn btn-sm" onClick={() => void inviteCall(activeFriend.id)}><IconPhone size={14} /> {t('fr.call', 'Call')}</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setSharePick(sharePick ? null : 'pick')}><IconBroadcast size={13} /> {t('fr.share', 'Share')}</button>
                </div>
                {party.partyId ? (
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={inviting === activeFriend.id}
                    onClick={() => void sendPartyInvite(activeFriend.id)}
                  >
                    <IconHeadphones size={13} /> {inviting === activeFriend.id ? t('fr.inviting', 'Inviting…') : `${t('fr.inviteToParty', 'Invite to party')} ${party.code}`}
                  </button>
                ) : (
                  <span className="hint">{t('fr.createJoinToInvite', 'Create or join a party to invite')} {activeFriend.displayName}.</span>
                )}
              </div>
            </section>
          ) : party.partyId ? (
            <section className="fr-card party-box">
              <header className="fr-card-head">
                <span className="fr-card-title"><IconHeadphones size={15} /> {t('fr.listenParty', 'Listen party')}</span>
                <span className="chip chip-ok">{party.code}</span>
              </header>
              <div className="fr-card-body">
                <div className="fr-row fr-row-between">
                  <span className={`chip${party.isHost ? ' chip-ok' : ''}`}>{party.isHost ? t('fr.youAreHost', 'you are host') : t('fr.youAreGuest', 'you are guest')}</span>
                  <span className="fr-icon-btns">
                    <button className="btn btn-ghost btn-sm" title={t('fr.copyPartyCode', 'Copy party code')} onClick={() => navigator.clipboard.writeText(party.code).then(() => notify(t('toast.codeCopied', 'Code copied')))}><IconCopy size={12} /></button>
                    <button className="btn btn-ghost btn-sm" title={t('fr.leaveParty', 'Leave party')} onClick={() => void party.leave().then(() => notify(t('toast.leftParty', 'Left party')))}>{t('fr.leave', 'Leave')}</button>
                  </span>
                </div>
                <div className="party-now">
                  {partyTrack ? (
                    <>
                      <span className="hint">{t('ui.nowPlaying', 'Now playing')}</span>
                      <strong>{partyTrack.title}</strong> <span className="hint">— {partyTrack.artist}</span>
                    </>
                  ) : (
                    <span className="hint">{party.isHost ? t('fr.hostPlayHint', 'Play anything in the bottom bar — guests will follow.') : t('fr.waitingHost', 'Waiting for host to play something…')}</span>
                  )}
                </div>
                <div className="party-members">
                  <span className="fr-section-label">{t('fr.connected', 'Connected')} ({party.members.length})</span>
                  {party.members.length === 0
                    ? <span className="hint">{t('fr.waitingServer', 'waiting for server…')}</span>
                    : <div className="member-chips">{party.members.map(m => (
                      <span key={m.id} className="chip chip-ok" title={m.username}>{m.displayName}</span>
                    ))}</div>}
                </div>
              </div>
            </section>
          ) : (
            <section className="fr-card">
              <div className="fr-card-body">
                <p className="hint">{t('fr.pickFriendHint', 'Pick a friend to chat, call, or share a playlist. Create a party from the button below to listen together.')}</p>
                <div className="fr-row">
                  <button className="btn btn-sm" onClick={() => void createParty()} disabled={partyBusy}><IconBroadcast size={13} /> {partyBusy ? '…' : t('fr.createParty', 'Create party')}</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setShowJoinInput(v => !v)}>{t('fr.joinWithCode', 'Join with code')}</button>
                </div>
                {showJoinInput && (
                  <div className="fr-row">
                    <input value={party.code} onChange={e => party.setCodeInput(e.target.value)} placeholder={t('fr.codePlaceholder', 'CODE')} className="fr-code-input" />
                    <button className="btn btn-sm" onClick={() => void joinParty()} disabled={partyBusy}>{t('fr.join', 'Join')}</button>
                  </div>
                )}
              </div>
            </section>
          )}

          {incomingCall && (
            <div className="call-overlay incoming">
              <span>{t('fr.incomingCallFrom', 'Incoming call from')} {incomingCall.fromName}</span>
              <button className="btn" onClick={() => void acceptCall()}><IconPhone size={14} /> {t('fr.accept', 'Accept')}</button>
              <button className="btn btn-ghost" onClick={() => void declineCall()}><IconPhoneOff size={14} /> {t('fr.decline', 'Decline')}</button>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
