import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import * as api from '../lib/api'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import type { League } from '../lib/types'
import { Eyebrow, IconChevron, Loading, PageHead } from '../components/ui'

const STATUS_LABEL: Record<League['status'], string> = {
  lobby: 'Waiting to draft',
  drafting: 'Draft in progress',
  active: 'In season',
  completed: 'Season complete'
}

export default function MyLeagues () {
  const { name, signOut } = useAuth()
  const { fail } = useToast()
  const navigate = useNavigate()
  const [leagues, setLeagues] = useState<League[] | null>(null)

  useEffect(() => {
    api.getMyLeagues().then(setLeagues).catch(e => { fail(e); setLeagues([]) })
  }, [fail])

  // Someone who signed in from an invite link gets taken there once.
  useEffect(() => {
    const pending = sessionStorage.getItem('pendingInvite')
    if (pending) { sessionStorage.removeItem('pendingInvite'); navigate(`/join/${pending}`) }
  }, [navigate])

  return (
    <>
      <header className="masthead">
        <div className="masthead-inner">
          <div className="wordmark">The&nbsp;<i>Draft</i></div>
          <button className="btn quiet" onClick={() => void signOut()}>Sign out</button>
        </div>
      </header>

      <div className="page narrow">
        <PageHead
          title={name}
          meta="Your leagues, your draft board, and every point the Premier League gives you."
          aside={
            <div className="row gap-8 wrap">
              <Link className="btn" to="/new">Create a league</Link>
              <Link className="btn ghost" to="/join">Join with a code</Link>
            </div>
          } />

        <Eyebrow>Leagues</Eyebrow>

        {leagues === null ? <Loading rows={3} /> : leagues.length === 0 ? (
          <div className="slab">
            <h2 className="h3">Nothing here yet</h2>
            <p className="small muted mt-8">
              Create a league and send the invite code to your group chat, or paste in a
              code somebody sent you.
            </p>
          </div>
        ) : (
          // Ruled rows, not a stack of identical bordered cards: the league
          // name is the only thing that differs between them, so it should be
          // the only thing the eye has to travel between.
          <ul className="list">
            {leagues.map(l => (
              <li key={l.id}>
                <Link to={`/l/${l.id}`} className="list-row" style={{ padding: '18px 12px' }}>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="h3 truncate" style={{ display: 'block' }}>{l.name}</span>
                    <span className="row gap-8 mt-8" style={{ marginTop: 6 }}>
                      {l.status === 'drafting'
                        ? <span className="live">Drafting</span>
                        : <span className="tiny muted">{STATUS_LABEL[l.status]}</span>}
                      <span className="tiny muted num" style={{ letterSpacing: '.12em' }}>
                        {l.invite_code}
                      </span>
                    </span>
                  </span>
                  <span aria-hidden style={{ color: 'var(--rule-2)', display: 'flex' }}>
                    <IconChevron size={17} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
