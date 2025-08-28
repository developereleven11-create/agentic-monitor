'use client';

import { useEffect, useMemo, useState } from 'react';
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

/** Helpers */
const fmtMs = (n: number) => `${n?.toLocaleString?.() ?? n} ms`;
const totalDuration = (r: Run) => r.log.steps.reduce((s, x) => s + (x.ms || 0), 0);
const hostname = (u: string) => { try { return new URL(u).hostname.replace(/^www\./,''); } catch { return u; } };
const sevCls = (s: Run['severity']) => s === 'OK' ? 'badge badge-ok' : s === 'WARN' ? 'badge badge-warn' : 'badge badge-fail';

/** Build a raw GitHub base URL to load screenshots from the same repo as index.json */
function rawBaseFromIndexUrl(indexUrl: string): string | null {
  // Expecting .../main/runs/index.json -> return .../main/
  const m = indexUrl.match(/^(.*\/main)\/runs\/index\.json$/);
  return m ? `${m[1]}/` : null;
}

/** What each step checks */
const STEP_HELP: Record<string,string> = {
  homepage:     'Loads homepage, waits for network to go idle.',
  product_page: 'Opens product URL, waits for Add to Cart selector.',
  add_to_cart:  'Clicks Add to Cart, detects Cart Drawer or /cart page.',
  cart_loaded:  'Verifies cart presence (selector or URL contains /cart).',
};

export default function Page() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [openId, setOpenId] = useState<number|null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string|null>(null);

  const rawBase = useMemo(() => rawBaseFromIndexUrl(RUNS_INDEX), []);
  const brand = useMemo(() => runs[0]?.url?.STORE_URL ? hostname(runs[0].url.STORE_URL) : '', [runs]);

  async function load() {
    if (!RUNS_INDEX) { setErr('Environment variable NEXT_PUBLIC_RUNS_INDEX is not set.'); return; }
    try {
      setLoading(true); setErr(null);
      const res = await fetch(RUNS_INDEX, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${RUNS_INDEX}`);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('Data is not an array.');
      setRuns(data);
      if (data.length && openId == null) setOpenId(data[0].id); // auto-open latest
    } catch (e: any) {
      setErr(e?.message || 'Failed to load data.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-white/10 grid place-items-center text-lg font-bold">
            {brand ? brand[0]?.toUpperCase() : 'S'}
          </div>
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight">Shopify WatchDog</h1>
            {brand && <div className="text-sm text-neutral-400 mt-0.5">{brand}</div>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {runs[0]?.url?.STORE_URL && (
            <a className="btn badge" href={runs[0].url.STORE_URL} target="_blank" rel="noreferrer">Store</a>
          )}
          {runs[0]?.url?.PRODUCT_URL && (
            <a className="btn badge" href={runs[0].url.PRODUCT_URL} target="_blank" rel="noreferrer">Product</a>
          )}
          <button className="btn badge" onClick={load}>Reload</button>
        </div>
      </header>

      {/* Data source / messages */}
      <div className="card p-4 flex items-center justify-between">
        <div className="text-xs text-neutral-400">
          Source:&nbsp;
          <span className="text-neutral-300 break-all">{RUNS_INDEX || '(not set)'}</span>
        </div>
        <div className="text-xs text-neutral-400">Cron: every <span className="kbd">15m</span></div>
      </div>

      {loading && <div className="card p-6">Loading…</div>}
      {err && <div className="card p-6 text-rose-300">Error: {err}</div>}
      {!loading && !err && runs.length === 0 && (
        <div className="card p-6">
          <div className="font-medium">No runs yet</div>
          <div className="text-sm text-neutral-400 mt-1">
            Trigger a run in GitHub Actions → <span className="kbd">Monitor</span> → <span className="kbd">Run workflow</span>, then click Reload.
          </div>
        </div>
      )}

      {/* Runs list */}
      {runs.map(run => (
        <div key={run.id} className="card overflow-hidden">
          {/* Row header */}
          <div className="p-5 flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-3 flex-wrap">
                <span className={sevCls(run.severity)}>{run.severity}</span>
                <div className="font-semibold">
                  {new Date(run.log.startedAt).toLocaleString()}
                </div>
                <span className="badge badge-dim">
                  Total {fmtMs(totalDuration(run))}
                </span>
              </div>
              <div className="text-sm text-neutral-300">{run.summary}</div>
            </div>
            <button
              className="badge badge-dim hover:bg-white/10"
              onClick={() => setOpenId(openId === run.id ? null : run.id)}
            >
              {openId === run.id ? 'Hide' : 'View'}
            </button>
          </div>

          {/* Expandable detail */}
          <AnimatePresence>
            {openId === run.id && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="px-5 pb-5">
                  <div className="hr mb-4"></div>
                  <div className="grid md:grid-cols-3 gap-6">
                    {/* Timeline */}
                    <div className="md:col-span-2">
                      <ol className="relative border-l border-white/10 pl-6">
                        {run.log.steps.map((s, i) => (
                          <li key={i} className="mb-6">
                            <span className="absolute -left-[7px]">
                              <span className={`timeline-dot ${s.ok ? 'dot-ok' : 'dot-fail'}`}></span>
                            </span>
                            <div className="flex items-center justify-between">
                              <div className="font-medium capitalize">{s.name.replaceAll('_',' ')}</div>
                              <div className="text-sm text-neutral-400">{fmtMs(s.ms)}</div>
                            </div>
                            <div className="text-xs text-neutral-400 mt-1">
                              {STEP_HELP[s.name] || 'Step check'}
                            </div>
                            {!s.ok && s.error && (
                              <div className="text-sm text-rose-300 mt-2">{s.error}</div>
                            )}
                          </li>
                        ))}
                      </ol>
                    </div>

                    {/* Meta / Links / Screenshot */}
                    <div className="space-y-3">
                      <div className="text-sm text-neutral-400">
                        <div className="font-semibold text-neutral-200 mb-1">Context</div>
                        <div>
                          Store:{' '}
                          <a className="underline hover:opacity-80" href={run.url.STORE_URL} target="_blank" rel="noreferrer">
                            {hostname(run.url.STORE_URL)}
                          </a>
                        </div>
                        <div className="mt-1">
                          Product:{' '}
                          <a className="underline hover:opacity-80 break-all" href={run.url.PRODUCT_URL} target="_blank" rel="noreferrer">
                            {run.url.PRODUCT_URL}
                          </a>
                        </div>
                      </div>
                      {(run as any).meta?.cartMode && (
  <div className="mt-1">
    Cart mode: <span className="kbd">{(run as any).meta.cartMode}</span>
  </div>
)}


                      {run.screenshot && rawBase ? (
                        <div>
                          <div className="font-semibold text-neutral-200 mb-1">Screenshot</div>
                          <img
                            src={`${rawBase}${run.screenshot}`}
                            alt="Run screenshot"
                            className="rounded-lg border border-white/10 shadow-lg max-h-64 object-cover"
                          />
                          <div className="text-xs text-neutral-500 mt-1">Loaded from repo: {rawBase}{run.screenshot}</div>
                        </div>
                      ) : (
                        <div className="text-sm text-neutral-400">No screenshot</div>
                      )}

                      <div className="hr"></div>
                      <div className="text-xs text-neutral-400">
                        <div className="font-semibold text-neutral-300 mb-1">Checks performed</div>
                        <ul className="list-disc ml-4 space-y-1">
                          <li>Homepage loads and goes <span className="kbd">networkidle</span></li>
                          <li>Product page renders Add to Cart selector</li>
                          <li>Add to Cart click + cart drawer/page detection</li>
                          <li>Cart presence verified (selector or URL)</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}
