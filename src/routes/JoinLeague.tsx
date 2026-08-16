import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import * as api from '../lib/api'
import { useToast } from '../lib/toast'

export default function JoinLeague () {
  const { code: codeParam } = useParams()
  const navigate = useNavigate()
  const { fail } = useToast()
  const [code, setCode] = useState((codeParam ?? '').toUpperCase())
  const [team, setTeam] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit (e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const id = await api.joinLeague(code, team)
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
        <div style={{ maxWidth: 440, margin: '0 auto' }}>
          <div className="mt-40">
            <div className="eyebrow">Invitation</div>
            <h1 className="h1 mt-8">Join a league</h1>
          </div>

          <form onSubmit={submit} className="slab mt-24 stack gap-16">
            <label className="field">
              <span className="label">Invite code</span>
              <input className="input code" required minLength={6} maxLength={6}
                value={code}
                onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                placeholder="ABC123"
                autoCapitalize="characters" autoCorrect="off" spellCheck={false}
                autoFocus={!codeParam} />
            </label>

            <label className="field">
              <span className="label">Your team name</span>
              <input className="input" required minLength={2} maxLength={30}
                value={team} onChange={e => setTeam(e.target.value)}
                placeholder="Haaland Oates" autoFocus={!!codeParam} />
            </label>

            <button className="btn lg block" disabled={busy || code.length < 6}>
              {busy ? 'Joining…' : 'Join league'}
            </button>
          </form>
        </div>
      </div>
    </>
  )
}
