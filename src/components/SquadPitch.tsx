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
 * suggestion, not a green rectangle.
 */
export default function SquadPitch ({
  players, capacity = SQUAD_CAPS, compact = false
}: {
  players: PitchPlayer[]
  /** Slots per position: the 2/5/5/4 squad by default, or 1/4/4/2 for an XI. */
  capacity?: Record<Position, number>
  compact?: boolean
}) {
  // Goalkeepers at the bottom, forwards at the top — the way a formation is drawn.
  const rows: Position[] = ['FWD', 'MID', 'DEF', 'GK']

  const total = players.length
  const cap = POSITIONS.reduce((n, p) => n + capacity[p], 0)

  return (
    <div className="pitch" aria-label={`Squad: ${total} of ${cap} players`}>
      <svg className="pitch-lines" viewBox="0 0 300 400"
        preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <rect x="6" y="6" width="288" height="388" rx="6" />
        <line x1="6" y1="200" x2="294" y2="200" />
        <circle cx="150" cy="200" r="42" />
        <rect x="82" y="6" width="136" height="52" />
        <rect x="82" y="342" width="136" height="52" />
        <rect x="118" y="6" width="64" height="22" />
        <rect x="118" y="372" width="64" height="22" />
      </svg>

      <div className="pitch-rows">
        {rows.map(pos => {
          const owned = players.filter(p => p.position === pos)
          const empties = Math.max(0, capacity[pos] - owned.length)
          return (
            <div className="pitch-row" key={pos}>
              {owned.map(p => (
                <div className="slot filled" key={p.id} title={`${p.name} · ${p.club ?? ''}`}>
                  <span className="slot-name">{p.name}</span>
                  {!compact && <span className="slot-club">{p.club ?? ''}</span>}
                </div>
              ))}
              {Array.from({ length: empties }, (_, i) => (
                <div className="slot" key={`${pos}-${i}`}>
                  <span className="slot-pos">{pos}</span>
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
          aspect-ratio: ${cap > 11 ? '0.86' : '0.76'};
          min-height: ${cap > 11 ? '330px' : '300px'};
          border: 1px solid var(--line);
          border-radius: var(--radius);
          background:
            radial-gradient(120% 80% at 50% 0%, rgba(255,255,255,.04), transparent 70%),
            var(--bg-2);
          padding: ${compact ? '14px 10px' : '18px 14px'};
          overflow: hidden;
        }
        .pitch-lines {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          fill: none;
          stroke: var(--line);
          stroke-width: 1;
          opacity: .9;
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
          flex-wrap: wrap;
          gap: ${compact ? '5px' : '7px'};
        }
        .slot {
          flex: 0 1 auto;
          min-width: ${compact ? '54px' : '62px'};
          max-width: 96px;
          height: ${compact ? '38px' : '44px'};
          padding: 0 8px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 1px;
          border-radius: 8px;
          border: 1px dashed var(--line);
          background: rgba(255,255,255,.012);
          transition: border-color .25s var(--ease), background .25s var(--ease);
        }
        .slot.filled {
          border-style: solid;
          border-color: var(--accent-edge);
          background: linear-gradient(180deg, var(--accent-wash), transparent), var(--surface-2);
          box-shadow: 0 4px 18px -8px rgba(124, 92, 255, .7);
          animation: slotIn .32s var(--ease) both;
        }
        .slot-name {
          font-size: ${compact ? '10.5px' : '11.5px'};
          font-weight: 600;
          letter-spacing: -.015em;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--text);
        }
        .slot-club {
          font-family: var(--font-mono);
          font-size: 8.5px;
          letter-spacing: .04em;
          color: var(--text-3);
        }
        .slot-pos {
          font-family: var(--font-mono);
          font-size: 9px;
          font-weight: 600;
          letter-spacing: .08em;
          color: var(--text-3);
          opacity: .42;
        }
        @keyframes slotIn {
          from { opacity: 0; transform: scale(.9); }
          to   { opacity: 1; transform: none; }
        }
      `}</style>
    </div>
  )
}
