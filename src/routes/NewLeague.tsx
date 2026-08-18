import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import * as api from '../lib/api'
import { useToast } from '../lib/toast'
import { Notice, PageHead } from '../components/ui'
import type { DraftMode } from '../lib/types'

export default function NewLeague () {
  const navigate = useNavigate()
  const { fail } = useToast()
  const [name, setName] = useState('')
  const [team, setTeam] = useState('')
  const [mode, setMode] = useState<DraftMode>('live')
  const [busy, setBusy] = useState(false)

  async function submit (e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const id = await api.createLeague(name, team, mode)
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
          <div className="wordmark">Gaffer</div>
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

            {/* The one decision that cannot be changed later, so it is made
                here rather than buried in a settings screen. */}
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="label" style={{ padding: 0 }}>How you’ll draft</legend>
              <div className="mode-choice">
                {([
                  ['live', 'Live', 'Everyone together, two minutes a pick. The clock picks for anyone who misses their turn.'],
                  ['async', 'Take your time', 'No clock. It is simply your turn until you take it — draft over days if you like.']
                ] as const).map(([value, title, blurb]) => (
                  <label key={value} className={`mode${mode === value ? ' is-on' : ''}`}>
                    <input type="radio" name="draft-mode" value={value}
                      checked={mode === value}
                      onChange={() => setMode(value)} />
                    <span className="mode-title">{title}</span>
                    <span className="mode-blurb">{blurb}</span>
                  </label>
                ))}
              </div>
            </fieldset>

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
