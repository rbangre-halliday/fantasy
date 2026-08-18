import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as api from '../lib/api'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'
import { relativeTime } from '../lib/format'
import type { Member, Message } from '../lib/types'

/**
 * League chat.
 *
 * The banter around a draft currently happens in a group chat somewhere else
 * while the draft happens here, which splits the event in two. This is the
 * smallest thing that closes that: a line of text, who said it, and when.
 *
 * Realtime is not a nicety here the way it is elsewhere in the app — a message
 * that needs a refresh to appear is not a conversation — so this both
 * subscribes and appends its own send optimistically.
 */
export default function Chat ({
  leagueId, members, meId, isCommissioner, compact = false
}: {
  leagueId: string
  members: Member[]
  meId: string
  isCommissioner: boolean
  compact?: boolean
}) {
  const { fail } = useToast()
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef<HTMLDivElement | null>(null)

  const teamOf = useMemo(() => new Map(members.map(m => [m.id, m])), [members])

  const load = useCallback(async () => {
    // Newest-first from the server so the limit takes the *recent* messages;
    // reversed here because a conversation reads downwards.
    setMessages((await api.getMessages(leagueId)).reverse())
  }, [leagueId])

  useEffect(() => {
    // If the chat migration has not been run, say so plainly instead of raising
    // an error toast on a screen the reader chose to open.
    load().catch(err => {
      if (/messages|relation|schema/i.test(String((err as Error).message))) setUnavailable(true)
      else fail(err)
    })
  }, [load, fail])

  useEffect(() => {
    const ch = supabase.channel(`chat:${leagueId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `league_id=eq.${leagueId}` },
        payload => {
          const msg = payload.new as Message
          setMessages(cur => cur && cur.some(m => m.id === msg.id) ? cur : [...(cur ?? []), msg])
        })
      .on('postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'messages', filter: `league_id=eq.${leagueId}` },
        payload => {
          const gone = payload.old as { id?: string }
          if (gone.id) setMessages(cur => cur?.filter(m => m.id !== gone.id) ?? cur)
        })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [leagueId])

  // Follow the conversation, but only when it grows.
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [messages?.length])

  async function send (e: React.FormEvent) {
    e.preventDefault()
    const body = draft.trim()
    if (!body || busy) return
    setBusy(true)
    try {
      await api.postMessage(leagueId, body)
      setDraft('')
      await load()          // never wait on the socket to see your own message
    } catch (err) { fail(err) } finally { setBusy(false) }
  }

  async function remove (id: string) {
    try { await api.deleteMessage(id); await load() } catch (err) { fail(err) }
  }

  if (unavailable) {
    return (
      <div className="notice warn">
        Chat isn’t switched on for this project yet — run supabase/07_chat.sql and
        reload.
      </div>
    )
  }

  return (
    <div className={`chat${compact ? ' is-compact' : ''}`}>
      <div className="chat-log">
        {messages === null ? (
          <p className="tiny muted" style={{ padding: 12 }}>Loading…</p>
        ) : messages.length === 0 ? (
          <p className="tiny muted" style={{ padding: 12 }}>
            Nothing said yet. Somebody has to go first.
          </p>
        ) : messages.map(m => {
          const author = teamOf.get(m.member_id)
          const mine = m.member_id === meId
          return (
            <div key={m.id} className={`msg${mine ? ' is-mine' : ''}`}>
              <div className="msg-head">
                <span className="msg-who truncate">
                  {mine ? 'You' : author?.team_name ?? 'A manager'}
                </span>
                <span className="msg-when">{relativeTime(m.created_at)}</span>
                {(mine || isCommissioner) && (
                  <button className="msg-x" aria-label="Delete message"
                    onClick={() => void remove(m.id)}>×</button>
                )}
              </div>
              <p className="msg-body">{m.body}</p>
            </div>
          )
        })}
        <div ref={endRef} />
      </div>

      <form className="chat-send" onSubmit={send}>
        <input className="input" value={draft} maxLength={500}
          onChange={e => setDraft(e.target.value)}
          placeholder="Say something" aria-label="Message" />
        <button className="btn" disabled={busy || !draft.trim()}>Send</button>
      </form>
    </div>
  )
}
