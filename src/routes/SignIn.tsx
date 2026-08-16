import { useEffect, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { supabase, readableError } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Loading, Notice } from '../components/ui'

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
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>

      {/* --- rail ---------------------------------------------------------- */}
      <header style={{
        borderBottom: '1px solid var(--line)',
        paddingTop: 'env(safe-area-inset-top)'
      }}>
        <div style={{
          maxWidth: 1240, margin: '0 auto', padding: '18px var(--gut)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between'
        }}>
          <div className="wordmark">The&nbsp;<i>Draft</i></div>
          <span className="eyebrow">Fantasy Premier League</span>
        </div>
      </header>

      {/* --- hero ---------------------------------------------------------- */}
      <main style={{ flex: 1 }}>
        <div style={{ maxWidth: 1240, margin: '0 auto', padding: '0 var(--gut)' }}>
          <div className="crosshair" style={{ padding: 'clamp(48px, 9vw, 104px) 0' }}>
            {/* the four corner ticks */}
            <span className="mark" style={{ top: -4, left: -4 }} />
            <span className="mark" style={{ top: -4, right: -4 }} />
            <span className="mark" style={{ bottom: -4, left: -4 }} />
            <span className="mark" style={{ bottom: -4, right: -4 }} />

            <div style={{
              display: 'grid', gap: 'clamp(40px, 6vw, 80px)',
              gridTemplateColumns: 'minmax(0, 1fr)', alignItems: 'start'
            }} className="hero-grid">

              <div>
                <span className="eyebrow">Private leagues · 2–6 managers</span>
                <h1 style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 200,
                  fontSize: 'clamp(42px, 7.4vw, 92px)',
                  lineHeight: .98,
                  letterSpacing: '-.042em',
                  margin: '22px 0 0'
                }}>
                  A live snake draft
                  <br />
                  <span style={{ color: 'var(--text-3)' }}>for you and five friends.</span>
                </h1>

                <p className="mt-24" style={{
                  maxWidth: 480, fontSize: 16, lineHeight: 1.6, color: 'var(--text-2)'
                }}>
                  Every Premier League player belongs to exactly one squad. Draft him and
                  nobody else can have him. Official FPL points, all season, counted for you.
                </p>

                <dl className="mt-40" style={{
                  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(112px, 1fr))',
                  gap: 1, background: 'var(--line)', border: '1px solid var(--line)', margin: 0
                }}>
                  {[
                    ['16', 'players a squad'],
                    ['4-4-2', 'every week'],
                    ['2 min', 'a pick'],
                    ['1', 'owner per player']
                  ].map(([big, small]) => (
                    <div key={small} style={{ background: 'var(--bg)', padding: '16px 14px' }}>
                      <dt className="num" style={{
                        fontSize: 21, fontWeight: 500, letterSpacing: '-.04em'
                      }}>{big}</dt>
                      <dd className="tiny muted" style={{ margin: '5px 0 0', lineHeight: 1.35 }}>
                        {small}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>

              {/* --- form ---------------------------------------------------- */}
              <div className="card card-pad" style={{ background: 'var(--surface)' }}>
                <div className="row gap-24" style={{ marginBottom: 20 }}>
                  {(['in', 'up'] as const).map(m => (
                    <button key={m}
                      onClick={() => { setMode(m); setError(null); setSent(false) }}
                      className="eyebrow"
                      style={{
                        background: 'none', border: 0, padding: '0 0 8px', cursor: 'pointer',
                        color: mode === m ? 'var(--text)' : 'var(--text-3)',
                        borderBottom: `1px solid ${mode === m ? 'var(--text)' : 'transparent'}`,
                        transition: 'color .18s, border-color .18s'
                      }}>
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

          {/* --- the rules ---------------------------------------------------- */}
          <section style={{ padding: 'clamp(44px, 7vw, 88px) 0' }}>
            <span className="eyebrow">How it works</span>
            <div className="mt-24" style={{
              display: 'grid', gap: 1, background: 'var(--line)',
              border: '1px solid var(--line)',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))'
            }}>
              {[
                ['01', 'Draft', 'Randomised snake order, two minutes a pick. Miss the clock and the best available player is taken for you.'],
                ['02', 'Own', 'Sixteen players: 2 GK, 5 DEF, 5 MID, 4 FWD. No budget, no captains, no chips.'],
                ['03', 'Score', 'Points come straight from official FPL. Players lock at their own kickoff and the bench subs in automatically.'],
                ['04', 'Deal', 'Free agents are first come, first served. Trade up to three-for-three, no vetoes.']
              ].map(([n, head, body]) => (
                <div key={n} style={{ background: 'var(--bg)', padding: '26px 22px' }}>
                  <span className="num tiny" style={{ color: 'var(--text-3)' }}>{n}</span>
                  <h3 className="h3" style={{ marginTop: 12 }}>{head}</h3>
                  <p className="small muted" style={{ marginTop: 8, lineHeight: 1.55 }}>{body}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>

      <style>{`
        @media (min-width: 940px) {
          .hero-grid { grid-template-columns: minmax(0, 1.15fr) minmax(360px, .85fr) !important; }
        }
      `}</style>
    </div>
  )
}
