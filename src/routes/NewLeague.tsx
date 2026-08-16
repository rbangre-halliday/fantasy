import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import * as api from '../lib/api'
import { useToast } from '../lib/toast'
import { Notice, PageHead } from '../components/ui'

export default function NewLeague () {
  const navigate = useNavigate()
  const { fail } = useToast()
  const [name, setName] = useState('')
  const [team, setTeam] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit (e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const id = await api.createLeague(name, team)
      navigate(`/l/${id}`, { replace: true })
    } catch (err) {
      fail(err); setBusy(false)
    }
  }

  return (
    <>
      <header className="masthead">
        <div className="masthead-inner">
          <Link to="/" className="btn quiet">← All leagues</Link>
          <div className="wordmark">The&nbsp;<i>Draft</i></div>
        </div>
      </header>

      <div className="page">
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          <PageHead
            title="Start a league"
            meta="One step. You’ll be the commissioner, and you decide when the draft starts." />

          <form onSubmit={submit} className="slab stack gap-16">
            <label className="field">
              <span className="label">League name</span>
              <input className="input" required minLength={2} maxLength={40}
                value={name} onChange={e => setName(e.target.value)}
                placeholder="Sunday League" autoFocus />
            </label>

            <label className="field">
              <span className="label">Your team name</span>
              <input className="input" required minLength={2} maxLength={30}
                value={team} onChange={e => setTeam(e.target.value)}
                placeholder="Vardy Party" />
            </label>

            <Notice>
              Up to five friends can join with the invite code you get next.
            </Notice>

            <button className="btn lg block" disabled={busy}>
              {busy ? 'Creating…' : 'Create league'}
            </button>
          </form>
        </div>
      </div>
    </>
  )
}
