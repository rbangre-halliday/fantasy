import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { IconChevron, PageHead } from '../components/ui'

/**
 * The rulebook.
 *
 * Public on purpose: the invite link is the first thing anyone sees of this
 * game, and "what are the rules" is a fair question to ask before making an
 * account. So this screen renders outside the league layout and outside the
 * auth gate.
 *
 * It is a reference document, which is a different job from the rest of the
 * app: read once end to end, then returned to for one clause at a time, often
 * from a link somebody pasted. Hence the jump nav that follows you down, the
 * anchored sections, and — first, above the document — the three questions
 * people actually arrive with.
 */

type Tone = 'plain' | 'no' | 'yes'
interface Clause { text: ReactNode; tone?: Tone }
interface Section {
  id: string
  nav: string          // the chip: short enough for a phone
  title: string
  lede?: string
  clauses: Clause[]
  before?: ReactNode
  after?: ReactNode
}

const no = (text: ReactNode): Clause => ({ text, tone: 'no' })

/** The squad shape, which every other rule on this page follows from. */
const SHAPE: Array<[string, number, number, number]> = [
  ['GK', 2, 1, 1],
  ['DEF', 5, 4, 1],
  ['MID', 5, 4, 1],
  ['FWD', 4, 2, 2]
]

const SECTIONS: Section[] = [
  {
    id: 'setup',
    nav: 'Setup',
    title: 'Setting up',
    lede: 'One person creates the league and becomes its commissioner. Everyone else joins with the six-character invite code.',
    clauses: [
      { text: <><b>Two to six managers.</b> The league is full at whatever limit it was created with — nobody else can get in.</> },
      { text: <><b>Everyone names their own team</b> on the way in, and can rename it whenever they like.</> },
      { text: <><b>Joining, leaving and removing all close when the draft starts.</b> Until then a manager can leave and the commissioner can remove anyone or delete the league. After the first pick, the group is fixed.</> },
      { text: <><b>The commissioner can’t leave their own league</b> — they delete it instead, and only while it’s still in the lobby.</> },
      { text: <><b>The season starts at the next gameweek.</b> Starting the draft locks the league’s first scoring gameweek to the next one coming up. Gameweeks already played never count, for anyone.</> }
    ]
  },
  {
    id: 'draft',
    nav: 'Draft',
    title: 'The draft',
    lede: 'Sixteen rounds, snake order, one player at a time. The order is randomised when the commissioner starts the draft and then fixed for the whole thing.',
    clauses: [
      { text: <><b>Snake order.</b> Round one runs first to last, round two runs back the other way, and so on for all sixteen rounds. Everyone ends up with exactly sixteen players.</> },
      { text: <><b>One owner per player, per league.</b> If two managers tap the same name in the same instant, exactly one of them gets him and the other is told he’s just gone.</> },
      { text: <><b>You can’t draft past a positional cap.</b> Once you hold two goalkeepers, goalkeepers stop being available to you. The caps add up to exactly sixteen, so obeying them is all it takes to finish with a legal squad.</> },
      { text: <><b>A live draft is on a clock</b> — two minutes a pick by default. It’s the server’s clock, so a slow laptop can’t cost you time or buy you any.</> },
      { text: <><b>Miss the clock and the pick is made for you:</b> the highest-ranked available player, on last season’s points, who still fits your squad.</> },
      { text: <><b>A take-your-time draft has no clock at all.</b> It’s simply your turn until you take it, so a league spread across time zones can draft over a week. Same snake, same caps, no auto-picks.</> },
      { text: <><b>If someone goes missing in a take-your-time draft, the commissioner can force their pick through</b> — the same best-available player a clock would have taken.</> },
      { text: <><b>The commissioner can pause a live draft</b> and resume it with the same time left on the pick, and can undo the most recent pick at any point — including after the last one, which reopens the draft.</> }
    ]
  },
  {
    id: 'squad',
    nav: 'Squad',
    title: 'Squad and formation',
    lede: 'Sixteen players, and the shape never changes all season. This one constraint is what makes every rule below it so strict.',
    before: (
      <div className="rules-shape">
        <table>
          <caption className="eyebrow">Fixed, all season</caption>
          <thead>
            <tr>
              <th scope="col">Position</th>
              <th scope="col">Squad</th>
              <th scope="col">Start</th>
              <th scope="col">Bench</th>
            </tr>
          </thead>
          <tbody>
            {SHAPE.map(([pos, squad, start, bench]) => (
              <tr key={pos}>
                <th scope="row"><span className={`pos ${pos}`}>{pos}</span></th>
                <td className="num">{squad}</td>
                <td className="num">{start}</td>
                <td className="num">{bench}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              <td className="num">16</td>
              <td className="num">11</td>
              <td className="num">5</td>
            </tr>
          </tfoot>
        </table>
      </div>
    ),
    clauses: [
      { text: <><b>Your XI is always 1 GK, 4 DEF, 4 MID, 2 FWD.</b> There’s no 3-5-2 and no 4-3-3. The only weekly decision is which of your players fill those eleven slots.</> },
      { text: <><b>Your five substitutes sit in a numbered order,</b> one to five. That order decides who comes on when the automatic substitutions run.</> },
      { text: <><b>Because 2/5/5/4 adds up to exactly sixteen,</b> any move that changed your positional mix would leave an illegal squad. That’s why signings and trades below have to be like-for-like.</> }
    ]
  },
  {
    id: 'lineups',
    nav: 'Lineups',
    title: 'Lineups and locking',
    lede: 'Change your XI as often as you like, right up to each player’s own kickoff. After that he’s yours for the week whatever happens.',
    clauses: [
      no(<><b>A player who has kicked off can’t be moved.</b> He locks the moment his club’s match in the current gameweek starts, and stays locked until that gameweek is finished — he can’t come out of your XI and he can’t go into it.</>),
      { text: <><b>Locking is per player, not a league deadline.</b> If your Saturday lunchtime midfielder has played, your Monday night striker is still free to move.</> },
      { text: <><b>A player whose club has no fixture this gameweek is never locked.</b></> },
      no(<><b>A swap needs both players free.</b> Tapping two players trades their places, so a locked substitute can no more come in than a locked starter can go out.</>),
      { text: <><b>No transfer costs, no limit on edits.</b> Rearranging your XI is free and unlimited.</>, tone: 'yes' },
      { text: <><b>Your lineup carries forward.</b> Each new gameweek starts as a copy of the last one, so you only touch it if you want something changed.</> },
      { text: <><b>Gaps fill themselves.</b> If a player leaves your squad, his slot is taken by the best-ranked eligible player you own — you’re never left with an incomplete XI.</> }
    ],
    after: (
      <p className="rules-note">
        <b>One quirk worth knowing.</b> Locking is judged against the current gameweek’s
        fixtures whichever week you’re editing, so while a player is mid-match you can’t
        shuffle him in next week’s lineup either. Wait for the gameweek to finish.
      </p>
    )
  },
  {
    id: 'subs',
    nav: 'Subs',
    title: 'Automatic substitutions',
    lede: 'You don’t have to be awake for kickoff. If a starter doesn’t play at all, your bench covers for him once the gameweek’s results land.',
    clauses: [
      { text: <><b>The trigger is zero minutes, not a bad score.</b> A starter who played and scored one point stays in. A starter who was benched, injured or suspended is replaced.</> },
      { text: <><b>Same position only,</b> so the formation never changes.</> },
      { text: <><b>Bench order decides who comes on</b> — the highest-priority substitute in that position who actually played.</> },
      { text: <><b>Each substitute can only come on once.</b></> },
      no(<><b>If nobody qualifies, the slot scores zero.</b> Two midfielders blank and only one midfielder on your bench played? The second slot takes a nil.</>)
    ]
  },
  {
    id: 'market',
    nav: 'Free agents',
    title: 'Free agents',
    lede: 'Any Premier League player nobody in your league owns is a free agent. No budget, no waiver period, no bidding — first tap wins.',
    clauses: [
      { text: <><b>Signings open the moment the draft is complete</b> and run to the end of the season.</> },
      { text: <><b>Every signing is a swap.</b> You always hold sixteen players, so signing one means dropping one in the same move.</> },
      no(<><b>Like-for-like, always.</b> Sign a midfielder, drop a midfielder. Anything else would break the 2/5/5/4 shape and is refused.</>),
      no(<><b>Neither player can be locked.</b> You can’t sign someone whose match has started, and you can’t drop someone of yours whose match has started.</>),
      { text: <><b>The new player inherits the dropped player’s slot</b> — starter or bench, same place in your lineup.</> },
      { text: <><b>The player you drop is a free agent immediately,</b> and anyone can sign him.</> }
    ]
  },
  {
    id: 'trades',
    nav: 'Trades',
    title: 'Trades',
    lede: 'Straight player-for-player deals between two managers. Propose, and the other manager accepts or rejects. No league vote, no veto window, no draft picks.',
    clauses: [
      { text: <><b>Trading opens once the draft is complete.</b></> },
      { text: <><b>One to three players each way.</b></> },
      no(<><b>Position-balanced, position by position.</b> <i>Saka + Isak</i> for <i>Salah + Watkins</i> works — a midfielder and a forward each way. <i>Saka</i> for <i>Saliba</i> doesn’t.</>),
      no(<><b>Nobody in the deal can be locked,</b> on either side. It’s checked when the trade is proposed and again when it’s accepted.</>),
      { text: <><b>Only the receiving manager can accept or reject;</b> only the proposer can cancel.</> },
      { text: <><b>Accepting kills the competing offers.</b> Any other pending trade involving a player who just moved is cancelled automatically.</> }
    ]
  },
  {
    id: 'predictions',
    nav: 'Predictions',
    title: 'Table predictions',
    lede: 'One guess a season, made before a ball is kicked: the twenty clubs in the order you think the real Premier League will finish. It pays a bonus on top of your squad’s points.',
    clauses: [
      { text: <><b>Order all twenty clubs</b> on the Predict tab. Your order saves as you go.</> },
      no(<><b>It locks at the first kickoff of your league’s first scoring gameweek</b> — the same moment the season starts counting. After that it can never be changed.</>),
      { text: <><b>Nobody can see your order until then.</b> Rivals see only whether you’ve entered; the picks are revealed together when the deadline passes.</> },
      { text: <><b>Your error is the sum of |predicted − actual| across the twenty clubs</b>, against the live table. Lower is better, and it moves every week as the real table does.</> },
      { text: <><b>A perfect table is worth 100 bonus points; a random shuffle is worth nothing.</b> A random order averages 133 out, so that is the zero point and the payout runs evenly from there up to perfect: <i>100 × (1 − error ÷ 133)</i>, never below zero.</> },
      { text: <><b>The bonus counts in the league table</b> and updates all season. The table shows it beside your squad points rather than folded in silently.</> },
      no(<><b>Miss the deadline and you score no bonus.</b> There’s no late entry.</>)
    ]
  },
  {
    id: 'scoring',
    nav: 'Scoring',
    title: 'Scoring and the table',
    lede: 'Official FPL points, unmodified. If a player scores twelve in the real game, he scores twelve for you.',
    clauses: [
      { text: <><b>Your gameweek score is your starting XI</b>, added up after automatic substitutions.</> },
      { text: <><b>Bench points never count</b> unless a substitute is brought on by the rule above.</> },
      { text: <><b>Your season total runs from your league’s first scoring gameweek</b> — the one after the draft — to gameweek 38.</> },
      { text: <><b>Live scores refresh every twenty minutes</b> while matches are on, and settle once FPL confirms the gameweek, bonus points included.</> },
      { text: <><b>The table is total points, highest first.</b> No head-to-head fixtures, no wins or draws, no playoffs — one season-long league table.</> },
      { text: <><b>The season closes</b> when the final gameweek is finished.</> }
    ]
  },
  {
    id: 'commish',
    nav: 'Commissioner',
    title: 'Commissioner powers',
    lede: 'Repair tools, not advantages — and every one of them shows up in the league’s activity for everybody to see.',
    clauses: [
      { text: <><b>Before the draft:</b> remove a manager, or delete the league.</> },
      { text: <><b>During the draft:</b> start it, pause and resume a live one, force a pick in a take-your-time one, and undo the last pick.</> },
      { text: <><b>During the season:</b> move a player onto a squad or release one — still inside the positional caps — and reverse an accepted trade, putting every player back where he came from.</> }
    ]
  },
  {
    id: 'not-here',
    nav: 'Not here',
    title: 'Not in this game',
    lede: 'Things you might expect from official FPL that deliberately don’t exist here.',
    clauses: [
      no(<><b>No captain or vice-captain.</b> Nothing is doubled.</>),
      no(<><b>No chips</b> — no wildcard, bench boost, triple captain or free hit.</>),
      no(<><b>No budget and no player prices.</b> Ownership comes from the draft, not from money.</>),
      no(<><b>No transfer limits or points deductions.</b> Signings are unlimited; they just have to be like-for-like.</>),
      no(<><b>No waivers and no bidding.</b> Free agents are first come, first served.</>),
      no(<><b>No shared players.</b> One owner each, all season.</>)
    ]
  }
]

/** The three questions people arrive with, answered before the document starts. */
const ANSWERS: Array<{ q: string; a: string; to: string }> = [
  {
    q: 'Can I take a player out once he’s played?',
    a: 'No. He locks at his own kickoff and stays locked until the gameweek is finished.',
    to: 'lineups'
  },
  {
    q: 'What if my starter doesn’t play?',
    a: 'Your bench covers him automatically — same position, best bench priority, formation unchanged.',
    to: 'subs'
  },
  {
    q: 'Can I sign anyone I like?',
    a: 'Anyone nobody owns, but it’s like-for-like: to sign a midfielder you drop a midfielder.',
    to: 'market'
  }
]

export default function Rules () {
  const navigate = useNavigate()
  const { hash } = useLocation()
  const [active, setActive] = useState(SECTIONS[0].id)
  const strip = useRef<HTMLDivElement>(null)

  const jump = useCallback((id: string) => {
    const el = document.getElementById(id)
    if (!el) return
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
    // Keep the URL shareable without pushing a history entry per chip — the
    // back button should leave the rulebook, not walk back up it.
    history.replaceState(null, '', `#${id}`)
    setActive(id)
  }, [])

  // A pasted /rules#trades has to land on the clause, and the browser's own
  // fragment scroll fires before the sections exist.
  useEffect(() => {
    if (!hash) return
    const id = hash.slice(1)
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ block: 'start' })
      setActive(id)
    })
  }, [hash])

  // Which section you're reading, so the chip strip tells you where you are.
  useEffect(() => {
    const els = SECTIONS.map(s => document.getElementById(s.id)).filter(Boolean) as HTMLElement[]
    const obs = new IntersectionObserver(entries => {
      const top = entries
        .filter(e => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      if (top) setActive(top.target.id)
    }, { rootMargin: '-38% 0px -55% 0px' })
    els.forEach(el => obs.observe(el))
    return () => obs.disconnect()
  }, [])

  // On a phone the strip scrolls sideways, so the current chip has to be
  // brought into it — scrollIntoView would drag the page as well.
  useEffect(() => {
    const el = strip.current
    const chip = el?.querySelector<HTMLElement>('[aria-current="true"]')
    if (!el || !chip) return
    const target = chip.offsetLeft - (el.clientWidth - chip.offsetWidth) / 2
    el.scrollTo({ left: Math.max(0, target), behavior: 'smooth' })
  }, [active])

  return (
    <div className="rules-page">
      <header className="masthead">
        <div className="masthead-inner">
          <div className="row gap-12 grow" style={{ minWidth: 0 }}>
            {/* Back to wherever you came from — a rule you looked up mid-draft
                should hand you back the draft, not the leagues list. */}
            <button className="back-link" aria-label="Back"
              onClick={() => { if (history.length > 1) navigate(-1); else navigate('/') }}>
              <IconChevron dir="left" size={17} />
            </button>
            <div className="wordmark">Gaffer</div>
            <span className="status-tag">Rules</span>
          </div>
        </div>
      </header>

      <div className="page">
        <PageHead
          size="display"
          title="The rules"
          meta="A private Premier League draft for two to six friends. One owner per real player, a fixed sixteen-man squad, and official FPL points from the draft to the end of the season. Every rule here is enforced by the server — none of it is on the honour system." />

        <div className="rules-answers">
          {ANSWERS.map(a => (
            <a key={a.to} className="card card-pad rules-answer" href={`#${a.to}`}
              onClick={e => { e.preventDefault(); jump(a.to) }}>
              <span className="rules-q">{a.q}</span>
              <span className="small muted">{a.a}</span>
              <span className="rules-more">
                Read the clause <IconChevron size={13} />
              </span>
            </a>
          ))}
        </div>

        {/* Contents: a strip that sticks under the masthead on a phone, a rail
            beside the document on a desktop. Either way it says where you are,
            which is the one thing a long document has to keep telling you. */}
        <div className="rules-grid">
          <nav className="rules-nav" aria-label="Contents">
            <div className="rules-jump" ref={strip}>
              {SECTIONS.map(s => (
                <a key={s.id} href={`#${s.id}`}
                  aria-current={active === s.id ? 'true' : undefined}
                  onClick={e => { e.preventDefault(); jump(s.id) }}>
                  {s.nav}
                </a>
              ))}
            </div>
          </nav>

          <div className="rules-doc">
            {SECTIONS.map(s => (
              <section key={s.id} id={s.id} className="rules-section">
                <h2 className="h2">{s.title}</h2>
                {s.lede && <p className="standfirst">{s.lede}</p>}
                {s.before}
                <ul className="rules-list">
                  {s.clauses.map((c, i) => (
                    <li key={i} className={c.tone && c.tone !== 'plain' ? `is-${c.tone}` : ''}>
                      {c.text}
                    </li>
                  ))}
                </ul>
                {s.after}
              </section>
            ))}

            <p className="rules-note mt-40">
              Anything on this page you think the app gets wrong is a bug, not a house
              rule — the database enforces all of it.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
