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
        // With email confirmation on, there's no session yet.
        if (!data.session) setSent(true)
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
    <div className="page" style={{ paddingBottom: 48 }}>
      <div style={{ maxWidth: 1020, margin: '0 auto' }}>

        {/* Masthead — the one place the type gets to be loud. */}
        <div style={{ paddingTop: 'max(40px, env(safe-area-inset-top))' }}>
          <div className="eyebrow">Est. this season · Six managers · One squad each</div>
          <h1 className="h1 mt-8" style={{ fontSize: 'clamp(46px, 12vw, 116px)', lineHeight: .88 }}>
            The&nbsp;Draft
          </h1>
          <div className="divider strong mt-16" />
          <p className="mt-16" style={{ maxWidth: 560, fontSize: 17, lineHeight: 1.5 }}>
            Fantasy Premier League the way it should be with friends: a live snake draft,
            and <em style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 20 }}>one owner per player</em>.
            If someone takes Salah, nobody else gets Salah. Official FPL points, all season.
          </p>
        </div>

        <div className="mt-32" style={{
          display: 'grid', gap: 28,
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          alignItems: 'start'
        }}>
          {/* form */}
          <div className="slab green" style={{ order: 0 }}>
            <div className="row gap-16" style={{ marginBottom: 14 }}>
              <button className={`btn quiet ${mode === 'in' ? '' : 'muted'}`}
                style={{ textDecorationColor: mode === 'in' ? 'var(--green)' : 'transparent',
                         color: mode === 'in' ? 'var(--ink)' : 'var(--ink-3)' }}
                onClick={() => { setMode('in'); setError(null); setSent(false) }}>
                Sign in
              </button>
              <button className="btn quiet"
                style={{ textDecorationColor: mode === 'up' ? 'var(--green)' : 'transparent',
                         color: mode === 'up' ? 'var(--ink)' : 'var(--ink-3)' }}
                onClick={() => { setMode('up'); setError(null); setSent(false) }}>
                Create account
              </button>
            </div>

            {sent ? (
              <Notice kind="good">
                Check your inbox for a confirmation link, then come back and sign in.
              </Notice>
            ) : (
              <form onSubmit={submit} className="stack gap-12">
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

                <button className="btn lg block mt-8" disabled={busy}>
                  {busy ? 'One moment…' : mode === 'up' ? 'Create account' : 'Sign in'}
                </button>
              </form>
            )}

            {invite && (
              <p className="small muted mt-16">
                You’ll join league <span className="num">{invite.toUpperCase()}</span> as soon as you’re in.
              </p>
            )}
          </div>

          {/* the rules, stated plainly */}
          <div>
            <Rule n="01" head="Draft, don’t duplicate">
              Two to six managers, a randomised snake order, two minutes a pick.
              Every EPL player belongs to exactly one squad.
            </Rule>
            <Rule n="02" head="Sixteen players, one shape">
              2 GK, 5 DEF, 5 MID, 4 FWD. You start eleven in a fixed 4-4-2.
              No captains, no budget, no chips.
            </Rule>
            <Rule n="03" head="Real points, automatically">
              Scores come straight from official FPL. Players lock at their own kickoff,
              and missing starters are subbed off the bench for you.
            </Rule>
            <Rule n="04" head="Free agents and trades">
              Unowned players are first come, first served. Trade up to three-for-three
              with anyone, no vetoes, no committee.
            </Rule>
          </div>
        </div>
      </div>
    </div>
  )
}

function Rule ({ n, head, children }: { n: string; head: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 16, padding: '16px 0', borderTop: '1px solid var(--rule)' }}>
      <span className="num" style={{ color: 'var(--rule-strong)', fontSize: 13, paddingTop: 3 }}>{n}</span>
      <div>
        <h3 className="h3">{head}</h3>
        <p className="small muted mt-8" style={{ lineHeight: 1.5 }}>{children}</p>
      </div>
    </div>
  )
}
