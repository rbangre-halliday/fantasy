import type { Position } from '../lib/types'
import { POSITIONS, SQUAD_CAPS } from '../lib/types'

export interface PitchPlayer {
  id: number
  name: string
  club: string | null
  position: Position
  /**
   * The club's Premier League code, which is what its kit image is filed
   * under. Optional: without it the slot simply has no shirt, which is how it
   * looked before.
   */
  kit?: number
}

/**
 * Club kits, from FPL's own asset path. This is how FPL solves the imagery
 * problem and it is the right answer: a kit belongs to a club, so it cannot go
 * stale the way a player photo does when he transfers. Goalkeepers wear a
 * different shirt, hence the suffix.
 */
const kitUrl = (code: number, gk: boolean) =>
  `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${code}${gk ? '_1' : ''}-66.png`

/**
 * The squad as a shape rather than a list: 2/5/5/4 laid out on a pitch, empty
 * slots dashed until you fill them. During a draft it answers "what do I still
 * need?" at a glance, which a row of counters never quite does.
 *
 * Markings are hairline SVG on the same black as everything else — a pitch by
 * suggestion, not a green rectangle. A filled slot is a flat block of
 * ultraviolet: no glow, no gradient, no scale-in. The shape is the
 * information, and the shape is legible without any of that.
 */
export default function SquadPitch ({
  players, capacity = SQUAD_CAPS, compact = false,
  onSelect, selected, canSwap, points, locked
}: {
  players: PitchPlayer[]
  /** Slots per position: the 2/5/5/4 squad by default, or 1/4/4/2 for an XI. */
  capacity?: Record<Position, number>
  compact?: boolean
  /** Supplied on the squad screen, where the pitch *is* the lineup editor. */
  onSelect?: (id: number) => void
  selected?: number | null
  canSwap?: (id: number) => boolean
  points?: (id: number) => number | undefined
  locked?: (id: number) => boolean
}) {
  // Goalkeepers at the bottom, forwards at the top — the way a formation is drawn.
  const rows: Position[] = ['FWD', 'MID', 'DEF', 'GK']

  const total = players.length
  const cap = POSITIONS.reduce((n, p) => n + capacity[p], 0)

  // The viewBox is derived from the box's own aspect ratio rather than fixed at
  // 300×400, so the markings can be drawn 1:1 with no scaling. Cropping them to
  // fit — which is what the old fixed box did — sliced the penalty areas in half
  // and pushed the centre circle off the halfway line.
  const ratio = cap > 11 ? 0.86 : 0.76
  const W = 300
  const H = Math.round(W / ratio)
  const boxW = 150
  const boxH = Math.round(H * 0.15)
  const sixW = 70
  const sixH = Math.round(H * 0.06)

  return (
    <div className="pitch" aria-label={`Squad: ${total} of ${cap} players`}>
      {/* non-scaling-stroke keeps the markings a true hairline: min-height can
          push the box off its aspect ratio, and a scaled stroke would then be
          a different weight horizontally than vertically. */}
      <svg className="pitch-lines" viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none" vectorEffect="non-scaling-stroke" aria-hidden="true">
        <line x1="0" y1={H / 2} x2={W} y2={H / 2} />
        <circle cx={W / 2} cy={H / 2} r={W * 0.16} />
        <rect x={(W - boxW) / 2} y="0" width={boxW} height={boxH} />
        <rect x={(W - boxW) / 2} y={H - boxH} width={boxW} height={boxH} />
        <rect x={(W - sixW) / 2} y="0" width={sixW} height={sixH} />
        <rect x={(W - sixW) / 2} y={H - sixH} width={sixW} height={sixH} />
      </svg>

      <div className="pitch-rows">
        {rows.map(pos => {
          const owned = players.filter(p => p.position === pos)
          const empties = Math.max(0, capacity[pos] - owned.length)
          return (
            <div className="pitch-row" key={pos}>
              {owned.map(p => {
                const isSel = selected === p.id
                const swappable = canSwap?.(p.id) ?? false
                const isLocked = locked?.(p.id) ?? false
                const pts = points?.(p.id)
                const cls = ['slot', 'filled',
                  isSel && 'is-selected',
                  swappable && 'is-swappable',
                  isLocked && 'is-locked'].filter(Boolean).join(' ')

                // Drawn once, whether or not it can be tapped: a slot that
                // shows a score on your own squad and hides it on somebody
                // else's was two renderings of the same thing, and the second
                // one was quietly missing the number.
                const inner = (
                  <>
                    {p.kit && <img className="kit" src={kitUrl(p.kit, pos === 'GK')}
                      alt="" width={22} height={22} loading="lazy" decoding="async" />}
                    <span className="slot-name">{p.name}</span>
                    {pts !== undefined
                      ? <span className="slot-pts num">{pts}</span>
                      : (!compact && !p.kit) && <span className="slot-club">{p.club ?? ''}</span>}
                  </>
                )

                // A button only where it does something. On screens that use
                // the pitch as a diagram this stays a div, so nothing offers
                // an interaction it cannot honour. A locked player is *not*
                // disabled: he can no longer be moved, but he is the one you
                // most want to open, because his points have started arriving.
                return onSelect ? (
                  <button type="button" className={cls} key={p.id}
                    aria-pressed={isSel}
                    title={`${p.name} · ${p.club ?? ''}`}
                    onClick={() => onSelect(p.id)}>
                    {inner}
                  </button>
                ) : (
                  <div className={cls} key={p.id} title={`${p.name} · ${p.club ?? ''}`}>
                    {inner}
                  </div>
                )
              })}
              {Array.from({ length: empties }, (_, i) => (
                // An empty slot is an absence. Repeating "DEF" down a column
                // of dashed boxes turns the pitch into a form; a single mark
                // says "nobody here yet" and lets the filled slots carry the
                // reading.
                <div className="slot" key={`${pos}-${i}`} aria-label={`Empty ${pos}`}>
                  <span className="slot-dot" />
                </div>
              ))}
            </div>
          )
        })}
      </div>

      <style>{`
        .pitch {
          position: relative;
          /* A real pitch is taller than it is wide; holding the ratio is what
             stops the centre circle stretching into an ellipse. */
          aspect-ratio: ${ratio};
          min-height: ${cap > 11 ? '330px' : '300px'};
          border: 1px solid var(--rule);
          border-radius: var(--r);
          background: var(--stock-1);
          padding: ${compact ? '14px 10px' : '18px 14px'};
          overflow: hidden;
        }
        .pitch-lines {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          fill: none;
          stroke: var(--rule);
          stroke-width: 1;
          vector-effect: non-scaling-stroke;
          pointer-events: none;
        }
        .pitch-rows {
          position: relative;
          height: 100%;
          display: flex;
          flex-direction: column;
          justify-content: space-around;
          gap: ${compact ? '8px' : '10px'};
        }
        .pitch-row {
          display: flex;
          justify-content: center;
          /* Never wrap. A five-slot row breaking to 4+1 draws a different
             formation, which is the one thing this diagram must not do — the
             slots shrink instead. */
          flex-wrap: nowrap;
          gap: ${compact ? '5px' : '7px'};
        }
        .slot {
          /* Shrink to share the row rather than pushing a sibling onto a new
             line; names ellipsis and keep their title attribute. */
          flex: 1 1 0;
          min-width: 0;
          max-width: 92px;
          height: ${compact ? '54px' : '58px'};
          padding: 0 7px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 1px;
          border-radius: var(--r-sm);
          border: 1px dashed var(--rule-2);
          background: transparent;
          transition: border-color .2s var(--ease), background .2s var(--ease);
        }
        .slot.filled {
          border-style: solid;
          border-color: var(--uv-line);
          background: var(--uv-block);
        }
        button.slot { font: inherit; color: inherit; cursor: pointer; }
        button.slot:disabled { cursor: default; }
        .slot.is-selected {
          border-color: var(--uv);
          background: var(--uv);
        }
        .slot.is-selected .slot-name,
        .slot.is-selected .slot-pts { color: var(--uv-ink); }
        /* Where this one can go. Dashed-to-solid on the accent is enough; a
           glow would be the only soft edge in the whole interface. */
        .slot.is-swappable { border-color: var(--uv); border-style: solid; }
        .slot.is-locked { opacity: .55; }
        .slot-pts {
          font-size: 11px;
          font-weight: 700;
          color: #B79BC6;
        }
        /* Names wrap to a second line rather than truncating. "Matheus N."
           clipped to "Mathe…" is not a player anyone can identify, and the
           slot has the height to spare once the club line is optional. */
        .slot-name {
          font-size: ${compact ? '10px' : '11px'};
          font-weight: 650;
          line-height: 1.06;
          letter-spacing: -.02em;
          max-width: 100%;
          text-align: center;
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          /* break-word, not anywhere: it breaks a word only when that word
             cannot fit a line by itself, where wrapping anywhere also shrank the
             slot's min-content width and split Semenyo into "Semeny / o".
             Names with a space or hyphen still wrap at the natural place. */
          overflow-wrap: break-word;
          word-break: normal;
          color: var(--fg);
        }
        /* Tinted from the block it sits on, never grey — grey on a coloured
           surface always reads as a mistake. */
        .slot-club {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: .09em;
          text-transform: uppercase;
          color: #B79BC6;
        }
        .kit { display: block; margin-bottom: 1px; object-fit: contain; }
        .slot-dot {
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background: var(--rule-2);
        }
      `}</style>
    </div>
  )
}
