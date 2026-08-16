import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import * as api from '../lib/api'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import type { League } from '../lib/types'
import { Eyebrow, Loading } from '../components/ui'

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

      <div className="page">
        <div className="mt-32">
          <div className="eyebrow">Good to see you</div>
          <h1 className="h1 mt-8">{name}</h1>
        </div>

        <div className="mt-32 row gap-12 wrap">
          <Link className="btn lg" to="/new">Create a league</Link>
          <Link className="btn lg ghost" to="/join">Join with a code</Link>
        </div>

        <div className="mt-40">
          <Eyebrow>Your leagues</Eyebrow>

          {leagues === null ? <Loading rows={3} /> : leagues.length === 0 ? (
            <div className="slab mt-8">
              <h2 className="h3">Nothing here yet</h2>
              <p className="small muted mt-8">
                Create a league and send the invite code to your group chat, or paste in a
                code somebody sent you.
              </p>
            </div>
          ) : (
            <ul className="stack gap-12">
              {leagues.map(l => (
                <li key={l.id}>
                  <Link to={`/l/${l.id}`} className="card card-pad"
                    style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="h3 truncate">{l.name}</div>
                      <div className="small muted mt-8 row gap-8">
                        {l.status === 'drafting'
                          ? <span className="live">Drafting</span>
                          : <span>{STATUS_LABEL[l.status]}</span>}
                        <span aria-hidden>·</span>
                        <span className="num">{l.invite_code}</span>
                      </div>
                    </div>
                    <span aria-hidden style={{ fontSize: 22, color: 'var(--rule-strong)' }}>→</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  )
}
