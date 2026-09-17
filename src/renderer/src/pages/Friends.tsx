import { useEffect, useState } from 'react'
import { useApp } from '../store/app'
import { useSocial } from '../store/social'
import { playlistToSharePayload } from '@shared/social'
import { IconChat, IconPhone, IconPhoneOff, IconMic, IconMicOff, IconSend, IconUserPlus, IconCheck, IconX, IconCopy, IconBroadcast, IconHeadphones, IconSearch } from '../components/Icons'
import { endCall, handleSignal, setMuted, startCall } from '../social/rtc'

export function FriendsPage(): React.JSX.Element {
  const { tracks, playlists, notify } = { tracks: useApp(s => s.tracks), playlists: useApp(s => s.playlists), notify: useApp(s => s.notify) }
  const social = useSocial()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<{ id: string; username: string; displayName: string; status?: string }[]>([])
  const [searching, setSearching] = useState(false)
  const [serverUrl, setServerUrl] = useState(social.serverUrl)
  const [onlineUser, setOnlineUser] = useState('')
  const [onlinePass, setOnlinePass] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [isRegister, setIsRegister] = useState(false)
  const [busy, setBusy] = useState(false)

  // chat
  const [activeConv, setActiveConv] = useState<string | null>(null)
  const [msgs, setMsgs] = useState<{ id: string; senderId: string; kind: string; body: string | null; payload: unknown; createdAt: string }[]>([])
  const [composer, setComposer] = useState('')
  const [sharePick, setSharePick] = useState<string | null>(null)

  // call
  const [callWith, setCallWith] = useState<string | null>(null)
  const [callId, setCallId] = useState<string | null>(null)
  const [muted, setMutedState] = useState(false)
  const [incomingCall, setIncomingCall] = useState<{ from: string; callId: string } | null>(null)

  // party
  const [partyCode, setPartyCode] = useState('')
  const [partyId, setPartyId] = useState<string | null>(null)

  useEffect(() => { void social.refresh() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const off = window.spinity.events.onSocial((evt) => {
      if (evt.type === 'call:incoming') {
        const p = evt.payload as { from: string; callId: string }
        setIncomingCall(p)
      } else if (evt.type === 'call:accepted' || evt.type === 'call:declined' || evt.type === 'call:ended') {
        if (evt.type === 'call:ended') { endCall(); setCallWith(null); setCallId(null) }
        if (evt.type === 'call:accepted') notify('Call accepted')
        if (evt.type === 'call:declined') { notify('Call declined'); endCall(); setCallWith(null); setCallId(null) }
      } else if (evt.type === 'call:signal') {
        const p = evt.payload as { signal: unknown }
        void handleSignal(p.signal)
      } else if (evt.type === 'chat:message') {
        const m = evt.payload as { conversationId: string }
        if (m.conversationId === activeConv) void loadMessages(m.conversationId)
        else void social.refresh()
      } else if (evt.type === 'party:state') {
        // party sync is applied by the player (kept minimal here)
      }
    })
    return off
  }, [activeConv]) // eslint-disable-line react-hooks/exhaustive-deps

  async function doSearch(): Promise<void> {
    const trimmed = q.trim()
    if (trimmed.length < 2) { setResults([]); return }
    setSearching(true)
    try { setResults(await social.search(trimmed)) } catch (err) { notify(err instanceof Error ? err.message : String(err), 'error') }
    finally { setSearching(false) }
  }

  async function connectOnline(): Promise<void> {
    if (!serverUrl.trim() || !onlineUser.trim() || !onlinePass) { notify('Fill server URL, username and password', 'error'); return }
    setBusy(true)
    try {
      social.setServerUrl(serverUrl.trim())
      if (isRegister) await window.spinity.social.register(serverUrl.trim(), onlineUser.trim(), onlinePass, displayName.trim() || undefined)
      else await window.spinity.social.login(serverUrl.trim(), onlineUser.trim(), onlinePass)
      await window.spinity.social.connect()
      notify(isRegister ? 'Online account created' : 'Connected to Spinity online')
      await social.refresh()
    } catch (err) { notify(err instanceof Error ? err.message : String(err), 'error') }
    finally { setBusy(false) }
  }

  async function loadMessages(convId: string): Promise<void> {
    try {
      const list = await window.spinity.social.messages(convId, 50)
      setMsgs(list as never)
      await window.spinity.social.read(convId).catch(() => {})
    } catch (err) { notify(err instanceof Error ? err.message : String(err), 'error') }
  }

  async function sendMessage(): Promise<void> {
    const body = composer.trim()
    if (!body || !activeConv) return
    // If activeConv is a userId (no conversation yet), send via toUserId
    const isConvId = /^[a-f0-9]{24}$/.test(activeConv) && social.conversations.some(c => c.id === activeConv)
    try {
      if (isConvId) await window.spinity.social.send({ conversationId: activeConv, kind: 'text', body })
      else await window.spinity.social.send({ toUserId: activeConv, kind: 'text', body })
      setComposer('')
      // reload
      const convs = await window.spinity.social.conversations().catch(() => [])
      // find conversation for this peer if we just created one
      if (!isConvId) {
        const found = (convs as { id: string; otherId: string }[]).find(c => c.otherId === activeConv)
        if (found) { setActiveConv(found.id); await loadMessages(found.id) } else void social.refresh()
      } else await loadMessages(activeConv)
    } catch (err) { notify(err instanceof Error ? err.message : String(err), 'error') }
  }

  async function sendPlaylist(playlistId: string): Promise<void> {
    const pl = playlists.find(p => p.id === playlistId)
    if (!pl || !activeConv) return
    const trackObjs = pl.trackIds.map(id => tracks.find(t => t.id === id)).filter(Boolean) as { id: string; title: string; artist: string; durationSec: number; thumbnail: string; webUrl: string }[]
    const localOnly = trackObjs.filter(t => !t.webUrl)
    if (localOnly.length && localOnly.length === trackObjs.length) { notify('That playlist only has local files — they have no shareable link', 'error'); return }
    const shareable = trackObjs.filter(t => !!t.webUrl)
    const payload = playlistToSharePayload(pl.name, shareable)
    const isConvId = social.conversations.some(c => c.id === activeConv)
    try {
      if (isConvId) await window.spinity.social.send({ conversationId: activeConv, kind: 'playlist', payload: payload as unknown })
      else await window.spinity.social.send({ toUserId: activeConv, kind: 'playlist', payload: payload as unknown })
      setSharePick(null)
      notify(`Shared playlist "${pl.name}"`)
      if (isConvId) await loadMessages(activeConv)
    } catch (err) { notify(err instanceof Error ? err.message : String(err), 'error') }
  }

  async function inviteCall(friendId: string): Promise<void> {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setCallWith(friendId); setCallId(id)
    // answer hook for callee side (our own incoming answer)
    ;(globalThis as unknown as { __spinitySendAnswer?: (sdp: string) => void }).__spinitySendAnswer = (sdp) => {
      void window.spinity.social.callSignal(friendId, id, { type: 'answer', sdp })
    }
    await window.spinity.social.callInvite(friendId, id)
    await startCall(friendId, id, true)
  }

  async function acceptCall(): Promise<void> {
    if (!incomingCall) return
    const p = incomingCall
    setCallWith(p.from); setCallId(p.callId); setIncomingCall(null)
    ;(globalThis as unknown as { __spinitySendAnswer?: (sdp: string) => void }).__spinitySendAnswer = (sdp) => {
      void window.spinity.social.callSignal(p.from, p.callId, { type: 'answer', sdp })
    }
    await window.spinity.social.callAccept(p.from, p.callId)
    await startCall(p.from, p.callId, false)
  }

  async function declineCall(): Promise<void> {
    if (!incomingCall) return
    await window.spinity.social.callDecline(incomingCall.from, incomingCall.callId)
    setIncomingCall(null)
  }

  function hangUp(): void {
    if (callWith && callId) void window.spinity.social.callEnd(callWith, callId)
    endCall(); setCallWith(null); setCallId(null)
  }

  return (
    <div className="friends-page">
      {/* Online account gate */}
      {!social.connected ? (
        <div className="friends-gate">
          <h2>Connect to Spinity online</h2>
          <p className="hint">Friends, chat, voice and listen party need an online account. Your local music stays on this PC.</p>
          <div className="field"><label>Server URL</label><input value={serverUrl} onChange={e => setServerUrl(e.target.value)} placeholder="http://node1.waifly.com:25386" /></div>
          <div className="field"><label>Username</label><input value={onlineUser} onChange={e => setOnlineUser(e.target.value)} placeholder="your handle" /></div>
          {isRegister && <div className="field"><label>Display name</label><input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Shown to friends" /></div>}
          <div className="field"><label>Password</label><input type="password" value={onlinePass} onChange={e => setOnlinePass(e.target.value)} /></div>
          <button className="btn" onClick={() => void connectOnline()} disabled={busy}>{busy ? 'Please wait…' : isRegister ? 'Create online account' : 'Connect'}</button>
          <button className="btn btn-ghost" onClick={() => setIsRegister(v => !v)}>{isRegister ? 'Already have one? Sign in' : 'No account yet? Create one'}</button>
          <p className="hint" style={{ marginTop: 8 }}>Hosted 24/7: <code>http://node1.waifly.com:25386</code> — change only for local dev (<code>http://localhost:3000</code>). STUN <code>stun:stun.l.google.com:19302</code> fallback.</p>
        </div>
      ) : (
        <>
          {/* Search */}
          <div className="friends-search">
            <div className="search-row">
              <span className="search-icon"><IconSearch size={16} /></span>
              <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && void doSearch()} placeholder="Search by username or display name (min 2 chars)" />
              <button className="btn btn-sm" onClick={() => void doSearch()} disabled={searching}>{searching ? '…' : 'Search'}</button>
            </div>
            {results.length > 0 && (
              <div className="search-results">
                {results.map(u => (
                  <div key={u.id} className="friend-row">
                    <span className="avatar sm">{u.displayName.slice(0, 1).toUpperCase()}</span>
                    <span className="friend-name">{u.displayName} <span className="hint">@{u.username}</span></span>
                    <button className="btn btn-sm" onClick={() => void social.request(u.id).then(() => notify(`Request sent to ${u.displayName}`)).catch(e => notify(String(e), 'error'))}><IconUserPlus size={14} /> Add</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Requests */}
          {(social.incoming.length > 0 || social.outgoing.length > 0) && (
            <div className="friends-requests">
              {social.incoming.length > 0 && <><h3>Requests</h3>{social.incoming.map(r => (
                <div key={r.id} className="friend-row">
                  <span>{r.from.displayName} @{r.from.username}</span>
                  <button className="btn btn-sm" onClick={() => void social.respond(r.id, true)}><IconCheck size={12} /> Accept</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => void social.respond(r.id, false)}><IconX size={12} /> Decline</button>
                </div>
              ))}</>}
              {social.outgoing.length > 0 && <div className="hint">Outgoing: {social.outgoing.length} pending</div>}
            </div>
          )}

          {/* Friends list */}
          <div className="friends-list">
            <h3>Friends ({social.friends.length})</h3>
            {social.friends.length === 0 && <p className="hint">No friends yet — search above to add someone.</p>}
            {social.friends.map(f => (
              <div key={f.id} className={`friend-row${activeConv === f.id ? ' active' : ''}`}>
                <span className={`presence-dot ${f.status ?? 'offline'}`} title={f.status ?? 'offline'} />
                <span className="avatar sm">{f.displayName.slice(0, 1).toUpperCase()}</span>
                <span className="friend-name">{f.displayName} <span className="hint">@{f.username}</span></span>
                <button className="btn btn-ghost btn-sm" title="Chat" onClick={() => { setActiveConv(f.id); void (async () => { const convs = await window.spinity.social.conversations().catch(() => []); const found = (convs as { id: string; otherId: string }[]).find(c => c.otherId === f.id); if (found) { setActiveConv(found.id); await loadMessages(found.id) } else setMsgs([]) })() }}><IconChat size={15} /></button>
                <button className="btn btn-ghost btn-sm" title="Voice call" onClick={() => void inviteCall(f.id)}><IconPhone size={15} /></button>
              </div>
            ))}
          </div>

          {/* Chat panel */}
          {activeConv && (
            <div className="chat-panel">
              <div className="chat-header">
                <span>Chat</span>
                <button className="btn btn-ghost btn-sm" onClick={() => setSharePick(sharePick ? null : 'pick')}><IconBroadcast size={13} /> Share playlist</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setActiveConv(null)}><IconX size={12} /></button>
              </div>
              {sharePick && (
                <div className="share-picker">
                  {playlists.length === 0 && <span className="hint">No playlists yet</span>}
                  {playlists.map(p => (
                    <button key={p.id} className="btn btn-sm" onClick={() => void sendPlaylist(p.id)}>{p.name} ({p.trackIds.length})</button>
                  ))}
                </div>
              )}
              <div className="chat-messages">
                {msgs.map(m => (
                  <div key={m.id} className={`chat-msg ${m.senderId === social.me?.id ? 'own' : ''}`}>
                    {m.kind === 'text' ? <span>{m.body}</span> : (
                      <span className="chat-share">🎵 {(m.payload as { name?: string })?.name ?? 'Playlist'} — {(m.payload as { tracks?: unknown[] })?.tracks?.length ?? 0} tracks
                        <button className="btn btn-sm" style={{ marginLeft: 8 }} onClick={() => {
                          const tracksToAdd = (m.payload as { tracks?: { videoId: string; title: string; artist: string; durationSec: number; thumbnail: string; webUrl: string }[] })?.tracks ?? []
                          for (const t of tracksToAdd) void window.spinity.downloads.start({ id: t.videoId, source: 'youtube', title: t.title, artist: t.artist, durationSec: t.durationSec, thumbnail: t.thumbnail, webUrl: t.webUrl }).catch(() => {})
                          notify(`Queued ${tracksToAdd.length} tracks`)
                        }}><IconHeadphones size={12} /> Add all</button>
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <div className="chat-composer">
                <input value={composer} onChange={e => setComposer(e.target.value)} onKeyDown={e => e.key === 'Enter' && void sendMessage()} placeholder="Message…" />
                <button className="btn btn-sm" onClick={() => void sendMessage()}><IconSend size={14} /></button>
              </div>
            </div>
          )}

          {/* Listen party */}
          <div className="party-box">
            <h3><IconHeadphones size={15} /> Listen party</h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-sm" onClick={async () => {
                const queue = playlists[0]?.trackIds.map(id => tracks.find(t => t.id === id)).filter(Boolean).map(t => ({ videoId: t!.id, title: t!.title, artist: t!.artist, durationSec: t!.durationSec, thumbnail: t!.thumbnail, webUrl: t!.webUrl })) ?? []
                try { const r = await window.spinity.social.partyCreate(queue); setPartyId(r.id); setPartyCode(r.code); notify(`Party ${r.code} created — share the code`) } catch (err) { notify(String(err), 'error') }
              }}><IconBroadcast size={13} /> Create party</button>
              <input value={partyCode} onChange={e => setPartyCode(e.target.value.toUpperCase())} placeholder="CODE" style={{ width: 90, textTransform: 'uppercase' }} />
              <button className="btn btn-sm" onClick={async () => {
                try { const r = await window.spinity.social.partyJoin(partyCode.trim()); setPartyId(r.id); notify(`Joined party ${r.code}`) } catch (err) { notify(String(err), 'error') }
              }}>Join</button>
              {partyId && <><span className="hint">Code: <strong>{partyCode || '—'}</strong> <button className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard.writeText(partyCode).then(() => notify('Code copied'))}><IconCopy size={12} /></button></span>
                <button className="btn btn-ghost btn-sm" onClick={async () => { if (partyId) await window.spinity.social.partyLeave(partyId).catch(() => {}); setPartyId(null) }}>Leave</button></>}
            </div>
          </div>

          {/* Incoming call overlay */}
          {incomingCall && (
            <div className="call-overlay incoming">
              <span>Incoming call from {incomingCall.from.slice(0, 8)}…</span>
              <button className="btn" onClick={() => void acceptCall()}><IconPhone size={14} /> Accept</button>
              <button className="btn btn-ghost" onClick={() => void declineCall()}><IconPhoneOff size={14} /> Decline</button>
            </div>
          )}
          {callWith && (
            <div className="call-bar">
              <span>On call with {callWith.slice(0, 8)}…</span>
              <button className="btn btn-ghost btn-sm" onClick={() => { const n = !muted; setMutedState(n); setMuted(n) }}>{muted ? <IconMicOff size={14} /> : <IconMic size={14} />} {muted ? 'Unmute' : 'Mute'}</button>
              <button className="btn btn-ghost btn-sm" onClick={hangUp}><IconPhoneOff size={14} /> End</button>
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <button className="btn btn-ghost btn-sm" onClick={async () => { await window.spinity.social.disconnect(); await social.refresh(); notify('Disconnected from online') }}>Disconnect online</button>
          </div>
        </>
      )}
    </div>
  )
}
