import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import * as api from '../lib/api'
import { useToast } from '../lib/toast'
import { Notice } from '../components/ui'

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
          <Link to="/" className="eyebrow">← All leagues</Link>
          <div className="wordmark">The&nbsp;<i>Draft</i></div>
        </div>
      </header>

      <div className="page">
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          <div className="mt-40">
            <div className="eyebrow">Step one of one</div>
            <h1 className="h1 mt-8">Start a league</h1>
          </div>

          <form onSubmit={submit} className="slab green mt-24 stack gap-16">
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
              You’ll be the commissioner. Up to five friends can join with your invite
              code, and you decide when the draft starts.
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
