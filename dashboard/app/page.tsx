'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

type Step = { name: string; ok: boolean; ms: number; error?: string };
type Log = { steps: Step[]; startedAt: string; storeUrl: string };
type Run = {
  id: number;
  severity: 'OK' | 'WARN' | 'FAIL';
  summary: string;
  log: Log;
  url: { STORE_URL: string; PRODUCT_URL: string };
  screenshot?: string | null;
};

const RUNS_INDEX = process.env.NEXT_PUBLIC_RUNS_INDEX || '';

function SeverityBadge({ sev }: { sev: Run['severity'] }) {
  const cls = sev === 'OK' ? 'badge badge-ok' : sev === 'WARN' ? 'badge badge-warn' : 'badge badge-fail';
  return <span className={cls}>{sev}</span>;
}

function StepDot({ ok }: { ok: boolean }) {
  const color = ok ? 'bg-green-400' : 'bg-red-400';
  return <div className={`timeline-dot ${color}`} />;
}

export default function Page() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    async function load() {
      if (!RUNS_INDEX) return;
      const res = await fetch(RUNS_INDEX, { cache: 'no-store' });
      if (!res.ok) return;
      setRuns(await res.json());
    }
    load();
  }, []);

  return (
    <div className="space-y-4">
      {runs.map((run) => (
        <div key={run.id} className="card p-4">
          <div className="flex items-center justify-between">
            <div>
              <SeverityBadge sev={run.severity} /> {new Date(run.log.startedAt).toLocaleString()}
              <div className="text-sm text-neutral-400">{run.summary}</div>
            </div>
            <button className="badge bg-neutral-800" onClick={() => setOpen(open === run.id ? null : run.id)}>
              {open === run.id ? 'Hide' : 'View'}
            </button>
          </div>
          <AnimatePresence>
            {open === run.id && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="mt-4 border-t border-neutral-800 pt-4">
                  <ol className="relative border-l border-neutral-700 pl-6">
                    {run.log.steps.map((s, i) => (
                      <li key={i} className="mb-4">
                        <span className="absolute -left-[7px]"><StepDot ok={s.ok} /></span>
                        <div className="flex justify-between">
                          <div>{s.name}</div>
                          <div className="text-sm text-neutral-400">{s.ms} ms</div>
                        </div>
                        {!s.ok && s.error && <div className="text-sm text-red-400">{s.error}</div>}
                      </li>
                    ))}
                  </ol>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}
