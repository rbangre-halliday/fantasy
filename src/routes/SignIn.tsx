import { useEffect, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { supabase, readableError } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Loading, Notice } from '../components/ui'
import SquadPitch from '../components/SquadPitch'

export default function SignIn () {
  const { session, loading } = useAuth()
  const [params] = useSearchParams()
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  // Someone opening an invite link before signing in lands here; keep the code
  // so we can drop them straight into the join screen afterwards.
  const invite = params.get('invite')
  useEffect(() => { if (invite) sessionStorage.setItem('pendingInvite', invite) }, [invite])

  if (loading) return <div className="page mt-40"><Loading rows={3} /></div>
  if (session) {
    const pending = sessionStorage.getItem('pendingInvite')
    return <Navigate to={pending ? `/join/${pending}` : '/'} replace />
  }

  async function submit (e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      if (mode === 'up') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { name: name.trim() || email.split('@')[0] } }
        })
        if (error) throw error
        if (!data.session) setSent(true)   // email confirmation is switched on
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(), password
        })
        if (error) throw error
      }
    } catch (err) {
      setError(readableError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    // 100dvh rather than 100%: #root is min-height now, so a percentage here
    // has no definite parent height to resolve against.
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>

      {/* --- rail ---------------------------------------------------------- */}
      <header style={{
        borderBottom: '1px solid var(--rule-2)',
        paddingTop: 'env(safe-area-inset-top)'
      }}>
        <div style={{
          maxWidth: 1240, margin: '0 auto', padding: '16px var(--gut)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16
        }}>
          <div className="wordmark">Gaffer</div>
          <span className="eyebrow">Fantasy Premier League</span>
        </div>
      </header>

      {/* --- hero ---------------------------------------------------------- */}
      <main style={{ flex: 1 }}>
        <div style={{ maxWidth: 1240, margin: '0 auto', padding: '0 var(--gut)' }}>
          {/* Asymmetric on purpose: generous above the headline, tighter below,
              so the hero and the section under it don't stack two full paddings
              into a gap with nothing in it. */}
          <div style={{ padding: 'clamp(44px, 8vw, 92px) 0 clamp(28px, 4vw, 44px)' }}>

            <div style={{
              display: 'grid', gap: 'clamp(40px, 6vw, 80px)',
              gridTemplateColumns: 'minmax(0, 1fr)', alignItems: 'start'
            }} className="hero-grid">

              <div>
                {/* Condensed caps, set solid and hard against the left rule.
                    A back-page headline, not a hero banner. */}
                <h1 className="h1">
                  A live snake draft
                  <br />
                  {/* Grey, not lilac. The second line dropping to a quieter
                      neutral separates the two clauses without spending the
                      accent, which the sign-in button needs more. */}
                  <span style={{ color: 'var(--fg-2)' }}>for you and five friends</span>
                </h1>

                <p className="standfirst" style={{ maxWidth: 460, fontSize: 16 }}>
                  Every Premier League player belongs to exactly one squad. Draft him and
                  nobody else can have him. Official FPL points, all season, counted for you.
                </p>

                <dl className="mt-40 facts">
                  {[
                    ['16', 'players a squad'],
                    ['4-4-2', 'every week'],
                    ['2 min', 'a pick'],
                    ['1', 'owner per player']
                  ].map(([big, small]) => (
                    <div key={small}>
                      <dt className="figure" style={{ fontSize: 30 }}>{big}</dt>
                      <dd className="tiny muted">{small}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              {/* --- form ---------------------------------------------------- */}
              <div className="card" style={{ padding: 'clamp(20px, 3vw, 30px)' }}>
                <div className="row gap-24 mode-tabs">
                  {(['in', 'up'] as const).map(m => (
                    <button key={m}
                      onClick={() => { setMode(m); setError(null); setSent(false) }}
                      className={`eyebrow${mode === m ? ' active' : ''}`}>
                      {m === 'in' ? 'Sign in' : 'Create account'}
                    </button>
                  ))}
                </div>

                {sent ? (
                  <Notice kind="good">
                    Check your inbox for a confirmation link, then come back and sign in.
                  </Notice>
                ) : (
                  <form onSubmit={submit} className="stack gap-14" style={{ gap: 14 }}>
                    {mode === 'up' && (
                      <label className="field">
                        <span className="label">Your name</span>
                        <input className="input" value={name} onChange={e => setName(e.target.value)}
                          autoComplete="name" placeholder="Rahul" />
                      </label>
                    )}
                    <label className="field">
                      <span className="label">Email</span>
                      <input className="input" type="email" required value={email}
                        onChange={e => setEmail(e.target.value)} autoComplete="email"
                        placeholder="you@example.com" />
                    </label>
                    <label className="field">
                      <span className="label">Password</span>
                      <input className="input" type="password" required minLength={6} value={password}
                        onChange={e => setPassword(e.target.value)}
                        autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
                        placeholder="At least 6 characters" />
                    </label>

                    {error && <Notice kind="error">{error}</Notice>}

                    <button className="btn lg block" style={{ marginTop: 6 }} disabled={busy}>
                      {busy ? 'One moment…' : mode === 'up' ? 'Create account' : 'Sign in'}
                    </button>
                  </form>
                )}

                {invite && (
                  <p className="small muted mt-16">
                    You’ll join league <span className="num" style={{ color: 'var(--text)' }}>
                      {invite.toUpperCase()}
                    </span> as soon as you’re in.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Every comparable product puts its actual interface on the
              landing page. Ours was a headline, a form and a paragraph — the
              draft clock and the squad shape, which are the whole reason to
              use this, were invisible until after signing up. */}
          <ProductShot />

          {/* --- the rules ----------------------------------------------------
              Four verbs in order. The steps read chronologically on their own,
              so numbering them was decoration standing in for structure. */}
          <section style={{ padding: 'clamp(32px, 4.5vw, 52px) 0 clamp(48px, 7vw, 88px)' }}>
            {/* The grid below sets its own margin to zero, so the room under
                this row has to come from the row. */}
            <div className="between wrap" style={{ marginBottom: 16 }}>
              <h2 className="h2">How it works</h2>
              <Link className="btn ghost" to="/rules">Read the full rules</Link>
            </div>
            <div className="mt-32 rules">
              {[
                ['Draft', 'Randomised snake order, two minutes a pick. Miss the clock and the best available player is taken for you.'],
                ['Own', 'Sixteen players: 2 GK, 5 DEF, 5 MID, 4 FWD. No budget, no captains, no chips.'],
                ['Score', 'Points come straight from official FPL. Players lock at their own kickoff and the bench subs in automatically.'],
                ['Deal', 'Free agents are first come, first served. Trade up to three-for-three, no vetoes.']
              ].map(([head, body]) => (
                <div key={head}>
                  <h3 className="h3">{head}</h3>
                  <p className="small muted">{body}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>

      <style>{`
        @media (min-width: 940px) {
          .hero-grid { grid-template-columns: minmax(0, 1.15fr) minmax(360px, .82fr) !important; }
        }

        /* Sign in / create account: an underline, the same device the desktop
           tab strip uses, so the app only teaches you one idea of "selected". */
        .mode-tabs { margin-bottom: 24px; border-bottom: 1px solid var(--rule); }
        .mode-tabs button {
          position: relative;
          background: none; border: 0; padding: 0 0 12px; cursor: pointer;
          color: var(--fg-3);
          transition: color .16s var(--ease);
        }
        .mode-tabs button:hover { color: var(--fg-2); }
        .mode-tabs button.active { color: var(--fg); }
        .mode-tabs button.active::after {
          content: ''; position: absolute; left: 0; right: 0; bottom: -1px;
          height: 2px; background: var(--uv-lift);
        }

        /* Hairline-ruled cells: the rules ARE the grid, drawn once by the gap
           showing the container through. No card borders, no nesting. */
        .facts, .rules {
          display: grid; gap: 1px; margin: 0;
          background: var(--rule);
          border: 1px solid var(--rule);
        }
        .facts { grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); }
        .facts > div { background: var(--stock-0); padding: 18px 16px; }
        .facts dd { margin: 8px 0 0; line-height: 1.35; }

        .rules { grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); }
        .rules > div { background: var(--stock-0); padding: 26px 22px; }
        .rules p { margin-top: 10px; line-height: 1.55; }
      `}</style>
    </div>
  )
}

/**
 * A still of the draft room: the clock at the moment it is yours, and a squad
 * half-built. Real components and real markup, not an image — it stays honest
 * as the design changes, and it costs no asset pipeline.
 */
function ProductShot () {
  const squad = [
    // Kit codes are the Premier League's own club ids, not FPL team ids.
    { id: 1, name: 'Haaland',     club: 'MCI', position: 'FWD' as const, kit: 43 },
    { id: 2, name: 'Saka',        club: 'ARS', position: 'MID' as const, kit: 3 },
    { id: 3, name: 'B.Fernandes', club: 'MUN', position: 'MID' as const, kit: 1 },
    { id: 4, name: 'Gabriel',     club: 'ARS', position: 'DEF' as const, kit: 3 },
    { id: 5, name: 'Virgil',      club: 'LIV', position: 'DEF' as const, kit: 14 },
    { id: 6, name: 'Raya',        club: 'ARS', position: 'GK'  as const, kit: 3 }
  ]
  // Enough rows that the board column stands as tall as the pitch beside it.
  const board = [
    ['MID', 'Salah',       'LIV', 211],
    ['FWD', 'Isak',        'NEW', 187],
    ['DEF', 'Saliba',      'ARS', 174],
    ['MID', 'Palmer',      'CHE', 168],
    ['MID', 'Gibbs-White', 'NFO', 162],
    ['FWD', 'Watkins',     'AVL', 158],
    ['DEF', 'Gvardiol',    'MCI', 151],
    ['GK',  'Sánchez',     'CHE', 146],
    ['MID', 'Semenyo',     'BOU', 141]
  ] as const

  return (
    <section className="shot" aria-label="The draft room">
      <div className="shot-main">
        <div className="shot-clock">
          <div>
            <span className="eyebrow">Round 6 · pick 11 of 32</span>
            <h2 className="shot-turn">You’re on the clock</h2>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="figure shot-time">1:42</div>
            <span className="eyebrow">Time left</span>
          </div>
        </div>
        <ul className="shot-board">
          {board.map(([pos, name, club, pts]) => (
            <li key={name}>
              <span className={`pos ${pos}`}>{pos}</span>
              <span className="grow">
                <span className="name">{name}</span>
                <span className="club" style={{ marginLeft: 8 }}>{club}</span>
              </span>
              <span className="num small">{pts}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="shot-side">
        <span className="eyebrow">Your squad · 6 of 16</span>
        <div style={{ marginTop: 10 }}>
          <SquadPitch players={squad} compact />
        </div>
      </div>
    </section>
  )
}
