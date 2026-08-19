import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import * as api from '../lib/api'
import { useToast } from '../lib/toast'
import { useLeague } from '../components/LeagueLayout'
import { Eyebrow, Notice, PageHead, Sheet } from '../components/ui'

export default function Lobby () {
  const { league, members, me, isCommissioner, refresh } = useLeague()
  const { toast, fail } = useToast()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [teamName, setTeamName] = useState(me.team_name)

  // /l/:id is the league's front door — it is what "My leagues" links to and
  // what people paste to each other — but the lobby is only the right screen
  // before the draft. Once it is running this was still offering "Start the
  // draft", a button whose only possible outcome was an error.
  if (league.status === 'drafting') return <Navigate to={`/l/${league.id}/draft`} replace />
  if (league.status === 'active' || league.status === 'completed') {
    return <Navigate to={`/l/${league.id}/team`} replace />
  }

  // Drafting happens on this same origin, so the invite link works for
  // anyone — signed in or not.
  const inviteUrl = `${window.location.origin}/join/${league.invite_code}`

  async function share () {
    const text = `Join my fantasy Premier League draft — code ${league.invite_code}`
    try {
      if (navigator.share) {
        await navigator.share({ title: league.name, text, url: inviteUrl })
      } else {
        await navigator.clipboard.writeText(`${text}\n${inviteUrl}`)
        toast('Invite copied to your clipboard', 'good')
      }
    } catch { /* user dismissed the share sheet */ }
  }

  async function run (fn: () => Promise<unknown>, done?: string) {
    setBusy(true)
    try { await fn(); await refresh(); if (done) toast(done, 'good') }
    catch (err) { fail(err) }
    finally { setBusy(false) }
  }

  const enough = members.length >= 2
  const full = members.length >= league.max_managers

  return (
    <div className="page narrow">
      <PageHead
        title={league.name}
        meta="Waiting room. Nobody can join once the draft starts." />

      {/* Invite code, given the space it deserves — it's the only thing that
          matters on this screen until everyone has arrived. */}
      <div className="slab green">
        <div className="eyebrow">Invite code</div>
        <div className="figure" style={{
          fontSize: 'clamp(46px, 13vw, 74px)', letterSpacing: '.1em',
          color: 'var(--fg)', marginTop: 10
        }}>
          {league.invite_code}
        </div>
        <div className="row gap-8 wrap mt-24">
          <button className="btn" onClick={() => void share()}>Share invite</button>
          <button className="btn ghost" onClick={() => {
            void navigator.clipboard.writeText(inviteUrl)
            toast('Link copied', 'good')
          }}>Copy link</button>
        </div>
      </div>

      <div className="mt-40">
        <div className="row gap-8 wrap" style={{ marginBottom: 14 }}>
          <span className="status-tag">
            {league.draft_mode === 'async' ? 'Take your time draft' : 'Live draft'}
          </span>
          <span className="tiny muted">
            {league.draft_mode === 'async'
              ? 'No clock — pick when it is your turn'
              : `${Math.round(league.pick_seconds / 60)} minutes a pick`}
          </span>
        </div>
        <Eyebrow>Managers · {members.length} of {league.max_managers}</Eyebrow>
        <ul className="list">
          {members.map(m => (
            <li key={m.id} className="list-row">
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="name truncate">{m.team_name}</div>
                <div className="tiny muted truncate">
                  {m.profiles?.name ?? 'Manager'}
                  {league.commissioner_id === m.user_id && ' · Commissioner'}
                  {m.id === me.id && ' · You'}
                </div>
              </div>
              {isCommissioner && m.user_id !== league.commissioner_id && (
                <button className="btn quiet" disabled={busy}
                  onClick={() => void run(() => api.removeManager(league.id, m.id), 'Manager removed')}>
                  Remove
                </button>
              )}
            </li>
          ))}
          {Array.from({ length: league.max_managers - members.length }, (_, i) => (
            <li key={`empty-${i}`} className="list-row">
              <div className="muted small">Empty seat</div>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-32 stack gap-12">
        {isCommissioner ? (
          <>
            {!enough && <Notice kind="warn">You need at least two managers before the draft can start.</Notice>}
            <Notice>
              Starting the draft randomises the pick order and locks the league —
              nobody can join after that.{' '}
              {league.draft_mode === 'async'
                ? 'There’s no clock: each manager picks in turn, whenever they get to it.'
                : 'Everyone needs to be here — two minutes a pick, and the clock picks for anyone who misses their turn.'}
            </Notice>
            <button className="btn lg block" disabled={!enough || busy}
              onClick={() => void run(() => api.startDraft(league.id))
                .then(() => navigate(`/l/${league.id}/draft`))}>
              {busy ? 'Starting…' : 'Start the draft'}
            </button>
          </>
        ) : (
          <Notice>Waiting for the commissioner to start the draft. You’ll be moved
            into the draft room automatically.</Notice>
        )}

        <div className="row gap-8 wrap mt-8">
          <button className="btn quiet" onClick={() => { setTeamName(me.team_name); setRenaming(true) }}>
            Rename my team
          </button>
          {/* The waiting room is the one moment when nobody is mid-decision,
              which makes it the right place to offer the rulebook. */}
          <Link className="btn quiet" to="/rules">Read the rules</Link>
          {isCommissioner ? (
            <button className="btn quiet" disabled={busy} onClick={() => {
              if (confirm('Delete this league for everyone? This cannot be undone.')) {
                void run(() => api.deleteLeague(league.id)).then(() => navigate('/'))
              }
            }}>Delete league</button>
          ) : (
            <button className="btn quiet" disabled={busy} onClick={() => {
              if (confirm('Leave this league?')) {
                void run(() => api.leaveLeague(league.id)).then(() => navigate('/'))
              }
            }}>Leave league</button>
          )}
        </div>
      </div>

      {full && <div className="mt-16"><Notice kind="good">The league is full.</Notice></div>}

      {renaming && (
        <Sheet title="Rename your team" onClose={() => setRenaming(false)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setRenaming(false)}>Cancel</button>
              <button className="btn" disabled={busy || teamName.trim().length < 2}
                onClick={() => void run(() => api.renameTeam(league.id, teamName), 'Team renamed')
                  .then(() => setRenaming(false))}>
                Save
              </button>
            </>
          }>
          <label className="field">
            <span className="label">Team name</span>
            <input className="input" value={teamName} maxLength={30} autoFocus
              onChange={e => setTeamName(e.target.value)} />
          </label>
        </Sheet>
      )}
    </div>
  )
}
