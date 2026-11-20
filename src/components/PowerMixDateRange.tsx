import { useEffect, useMemo, useState } from 'react';
import { Pill, PillRow } from '@/components/Responsive';
import { useSettings } from '@/contexts/SettingsContext';
import { ALL_TIME, addDays, isOrdered, isValidKey, makeKey, parseKey, presetRange, sameRange, type DateRange } from '@/powerMix/dateRange';
import { JALALI_MONTHS, gregorianToJalali, jalaliMonthLength, jalaliToGregorian } from '@/powerMix/jalali';
import { cryptoDayKey } from '@/powerMix/tehranTime';

type Calendar = 'jalali' | 'gregorian';

const PRESETS: { key: string; days: number | null; label: string }[] = [
  { key: 'd1', days: 1, label: 'pmRange1d' },
  { key: 'd7', days: 7, label: 'pmRange7d' },
  { key: 'd30', days: 30, label: 'pmRange30d' },
  { key: 'd90', days: 90, label: 'pmRange90d' },
  { key: 'all', days: null, label: 'pmRangeAll' },
];

interface PickerProps { label: string; value: string | null; calendar: Calendar; nowMs: number; onChange: (key: string | null) => void }

/** One date: three selects for the Jalali calendar, the browser's date input for the Gregorian one. Emits a Gregorian key. */
function DatePicker(props: PickerProps) {
  return props.calendar === 'gregorian' ? <GregorianPicker {...props} /> : <JalaliPicker {...props} />;
}

function GregorianPicker({ label, value, onChange }: PickerProps) {
  return (
    <label className="space-y-1 min-w-0">
      <span className="text-xs text-slate-400">{label}</span>
      <input type="date" dir="ltr" className="input-field text-sm" value={value ?? ''} onChange={(e) => onChange(isValidKey(e.target.value) ? e.target.value : null)} />
    </label>
  );
}

function JalaliPicker({ label, value, nowMs, onChange }: PickerProps) {
  const { t, lang } = useSettings();
  const nf = useMemo(() => new Intl.NumberFormat(lang === 'fa' ? 'fa-IR' : 'en-US', { useGrouping: false }), [lang]);
  const g = value ? parseKey(value) : null;
  const j = g ? gregorianToJalali(g) : null;
  const todayJ = gregorianToJalali(parseKey(cryptoDayKey(nowMs)) ?? { y: 2026, m: 1, d: 1 });
  const years = Array.from(new Set([...Array.from({ length: 6 }, (_, i) => todayJ.y - 4 + i), ...(j ? [j.y] : [])])).sort((a, b) => a - b);
  const [draft, setDraft] = useState<{ y: string; m: string; d: string }>({ y: j ? String(j.y) : '', m: j ? String(j.m) : '', d: j ? String(j.d) : '' });
  useEffect(() => { setDraft({ y: j ? String(j.y) : '', m: j ? String(j.m) : '', d: j ? String(j.d) : '' }); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (next: { y: string; m: string; d: string }) => {
    setDraft(next);
    if (!next.y || !next.m || !next.d) return;
    const y = Number(next.y), m = Number(next.m);
    const d = Math.min(Number(next.d), jalaliMonthLength(y, m)); // 31 Mehr -> 30 Mehr instead of an invalid date
    const gg = jalaliToGregorian({ y, m, d });
    onChange(makeKey(gg.y, gg.m, gg.d));
  };
  const maxDay = draft.y && draft.m ? jalaliMonthLength(Number(draft.y), Number(draft.m)) : 31;

  return (
    <div className="space-y-1 min-w-0">
      <span className="text-xs text-slate-400">{label}</span>
      <div className="grid grid-cols-3 gap-1.5">
        <select className="input-field text-sm" aria-label={t('pmDateDay')} value={draft.d} onChange={(e) => update({ ...draft, d: e.target.value })}>
          <option value="">{t('pmDateDay')}</option>
          {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{nf.format(d)}</option>)}
        </select>
        <select className="input-field text-sm" aria-label={t('pmDateMonth')} value={draft.m} onChange={(e) => update({ ...draft, m: e.target.value })}>
          <option value="">{t('pmDateMonth')}</option>
          {JALALI_MONTHS.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
        </select>
        <select className="input-field text-sm" aria-label={t('pmDateYear')} value={draft.y} onChange={(e) => update({ ...draft, y: e.target.value })}>
          <option value="">{t('pmDateYear')}</option>
          {years.map((y) => <option key={y} value={y}>{nf.format(y)}</option>)}
        </select>
      </div>
    </div>
  );
}

interface Props { value: DateRange; nowMs: number; onChange: (r: DateRange) => void }

/** Quick presets + a custom calendar range (Jalali or Gregorian) over TRADING days (03:30 → 03:30 Tehran). */
export function PowerMixDateRange({ value, nowMs, onChange }: Props) {
  const { t, lang } = useSettings();
  const [calendar, setCalendar] = useState<Calendar>(lang === 'fa' ? 'jalali' : 'gregorian');
  const matched = PRESETS.find((p) => sameRange(value, presetRange(p.days, nowMs)));
  const [custom, setCustom] = useState(false);
  const showCustom = custom || (!matched && !sameRange(value, ALL_TIME));
  const ordered = isOrdered(value);

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-slate-500">{t('pmDateRange')}</p>
      <PillRow>
        {PRESETS.map((p) => (
          <Pill key={p.key} active={!showCustom && matched?.key === p.key} onClick={() => { setCustom(false); onChange(presetRange(p.days, nowMs)); }}>{t(p.label)}</Pill>
        ))}
        <Pill active={showCustom} onClick={() => {
          setCustom(true);
          if (sameRange(value, ALL_TIME) || matched) onChange(presetRange(30, nowMs)); // start from something visible, the user then edits it
        }}>{t('pmRangeCustom')}</Pill>
      </PillRow>

      {showCustom && (
        <div className="space-y-2 rounded-lg bg-surface-100/60 p-2.5">
          <PillRow>
            <Pill active={calendar === 'jalali'} onClick={() => setCalendar('jalali')}>{t('pmCalJalali')}</Pill>
            <Pill active={calendar === 'gregorian'} onClick={() => setCalendar('gregorian')}>{t('pmCalGregorian')}</Pill>
          </PillRow>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <DatePicker label={t('pmDateFrom')} value={value.from} calendar={calendar} nowMs={nowMs} onChange={(k) => onChange({ ...value, from: k })} />
            <DatePicker label={t('pmDateTo')} value={value.to} calendar={calendar} nowMs={nowMs} onChange={(k) => onChange({ ...value, to: k })} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-secondary text-xs" onClick={() => onChange(ALL_TIME)}>{t('pmDateClear')}</button>
            <button className="btn-secondary text-xs" onClick={() => onChange({ from: addDays(cryptoDayKey(nowMs), -6), to: cryptoDayKey(nowMs) })}>{t('pmRange7d')}</button>
          </div>
          {!ordered && <p className="text-xs text-error-400">{t('pmDateInvalid')}</p>}
          <p className="text-[11px] text-slate-500 leading-5">{t('pmDateHint')}</p>
        </div>
      )}
    </div>
  );
}
