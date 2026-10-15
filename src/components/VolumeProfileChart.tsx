import type { ScalpPlan, VolumeProfile } from '@scalp';

interface Props {
  profile: VolumeProfile;
  price: number;
  plan?: ScalpPlan | null;
  height?: number;
}

const W = 340;
const LABEL_W = 62;
const BAR_X = LABEL_W + 6;
const BAR_MAX = W - BAR_X - 8;

function fmt(v: number): string {
  const abs = Math.abs(v);
  const d = abs < 1 ? 5 : abs < 10 ? 4 : abs < 1000 ? 2 : 1;
  return v.toFixed(d);
}

/**
 * Horizontal volume profile: one bar per price bin, value area highlighted, POC/VAH/VAL drawn as lines,
 * plus the last price and (when there is a plan) entry / stop / target. Always LTR so numbers read naturally.
 */
export function VolumeProfileChart({ profile, price, plan, height = 280 }: Props) {
  const levels = [profile.low, profile.high, price, plan?.stop, plan?.target].filter((v): v is number => typeof v === 'number');
  const lo = Math.min(...levels);
  const hi = Math.max(...levels);
  const pad = (hi - lo) * 0.04 || 1;
  const top = hi + pad;
  const bottom = lo - pad;
  const H = height;
  const y = (p: number) => ((top - p) / (top - bottom)) * (H - 8) + 4;
  const maxVol = Math.max(...profile.bins.map((b) => b.volume), 1);
  const barH = Math.max(1.5, (profile.step / (top - bottom)) * (H - 8) - 1);

  const line = (p: number, label: string, cls: string, dash?: string) => (
    <g key={label}>
      <line x1={BAR_X} x2={W - 4} y1={y(p)} y2={y(p)} className={cls} strokeWidth={1.25} strokeDasharray={dash} />
      <text x={LABEL_W} y={y(p) + 3} textAnchor="end" className="fill-slate-400" fontSize={9}>
        {label}
      </text>
    </g>
  );

  return (
    <div dir="ltr" className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-md mx-auto" role="img" aria-label="Volume profile">
        {profile.bins.map((b) => {
          const inVa = b.price >= profile.val && b.price <= profile.vah;
          const w = (b.volume / maxVol) * BAR_MAX;
          return (
            <rect
              key={b.price}
              x={BAR_X}
              y={y(b.price) - barH / 2}
              width={Math.max(w, 0.5)}
              height={barH}
              className={inVa ? 'fill-primary-500/45' : 'fill-slate-500/30'}
            />
          );
        })}
        {profile.lvn.map((p) => (
          <line key={`lvn${p}`} x1={BAR_X - 4} x2={BAR_X - 1} y1={y(p)} y2={y(p)} className="stroke-warning-400" strokeWidth={2} />
        ))}
        {profile.hvn.map((p) => (
          <line key={`hvn${p}`} x1={BAR_X - 4} x2={BAR_X - 1} y1={y(p)} y2={y(p)} className="stroke-accent-400" strokeWidth={2} />
        ))}
        {line(profile.vah, `VAH ${fmt(profile.vah)}`, 'stroke-primary-400', '3 3')}
        {line(profile.val, `VAL ${fmt(profile.val)}`, 'stroke-primary-400', '3 3')}
        {line(profile.poc, `POC ${fmt(profile.poc)}`, 'stroke-accent-400')}
        {plan && line(plan.target, `TP ${fmt(plan.target)}`, 'stroke-success-400', '5 2')}
        {plan && line(plan.stop, `SL ${fmt(plan.stop)}`, 'stroke-error-400', '5 2')}
        {line(price, `${fmt(price)}`, 'stroke-slate-100')}
      </svg>
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-slate-500 mt-1">
        <span><span className="inline-block w-2 h-2 rounded-sm bg-primary-500/60 me-1" />Value Area</span>
        <span><span className="inline-block w-2 h-0.5 bg-accent-400 me-1 align-middle" />HVN</span>
        <span><span className="inline-block w-2 h-0.5 bg-warning-400 me-1 align-middle" />LVN</span>
      </div>
    </div>
  );
}
