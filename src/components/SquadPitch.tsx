import type { Position } from '../lib/types'
import { POSITIONS, SQUAD_CAPS } from '../lib/types'

export interface PitchPlayer {
  id: number
  name: string
  club: string | null
  position: Position
}

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

                // A button only where it does something. On screens that use
                // the pitch as a diagram this stays a div, so nothing offers
                // an interaction it cannot honour.
                return onSelect ? (
                  <button type="button" className={cls} key={p.id}
                    disabled={isLocked}
                    aria-pressed={isSel}
                    title={`${p.name} · ${p.club ?? ''}`}
                    onClick={() => onSelect(p.id)}>
                    <span className="slot-name">{p.name}</span>
                    {pts !== undefined
                      ? <span className="slot-pts num">{pts}</span>
                      : !compact && <span className="slot-club">{p.club ?? ''}</span>}
                  </button>
                ) : (
                  <div className={cls} key={p.id} title={`${p.name} · ${p.club ?? ''}`}>
                    <span className="slot-name">{p.name}</span>
                    {!compact && <span className="slot-club">{p.club ?? ''}</span>}
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
          height: ${compact ? '38px' : '44px'};
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
        .slot-name {
          font-size: ${compact ? '11px' : '12px'};
          font-weight: 650;
          letter-spacing: -.012em;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
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
