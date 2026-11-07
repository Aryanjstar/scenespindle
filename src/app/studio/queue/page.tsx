"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { StudioBar } from "../../../components/studio/studio-bar";
import { ACTIVE, api, useLoad, usePending } from "../../../components/ui/client";
import { Button, Empty, Notice, STAGE_LABEL, timeAgo } from "../../../components/ui/kit";

type Item = { id: string; what: string; state: string; progress: number | null; stages: { name: string; state: string }[]; error: string | null; target: string; title: string; href: string | null; createdAt: string; finishedAt: string | null };

/** Everything the studio is doing for you, and what it finished recently. */
export default function QueuePage() {
  const { run, busy } = usePending();
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await api<{ items: Item[] }>("/api/jobs");
    if (!res.ok) { setError(res.error); setItems([]); return; }
    setItems(res.data.items);
  }, []);

  useLoad(load, [load]);
  useEffect(() => {
    const timer = setInterval(() => { void load(); }, 4000);
    return () => clearInterval(timer);
  }, [load]);

  const act = (id: string, action: "cancel" | "retry") => run(`${action}-${id}`, async () => {
    const res = await api(`/api/jobs/${id}/${action}`, { body: {} });
    if (!res.ok) setError(res.error);
    await load();
  });

  const active = (items ?? []).filter((i) => ACTIVE.includes(i.state));
  const done = (items ?? []).filter((i) => !ACTIVE.includes(i.state));
  const row = (i: Item) => {
    const stage = i.stages.find((s) => s.state === "running");
    return (
      <tr key={i.id}>
        <td><strong>{i.what}</strong><div className="fine">{i.href ? <Link href={i.href}>{i.title}</Link> : i.title}{i.target === "paired-agent" ? " · on your PC" : ""}</div></td>
        <td><span className="badge" data-tone={i.state === "succeeded" ? "ready" : i.state === "failed" ? "failed" : ACTIVE.includes(i.state) ? "rendering" : "review"}>{i.state === "waiting_quota" ? "waiting" : i.state}</span>{stage ? <div className="fine">{STAGE_LABEL[stage.name] ?? stage.name}</div> : null}{i.error ? <div className="fine error">{i.error}</div> : null}</td>
        <td className="fine">{timeAgo(i.finishedAt ?? i.createdAt)}</td>
        <td className="row-actions">
          {ACTIVE.includes(i.state) ? <Button tone="ghost" size="sm" pending={busy(`cancel-${i.id}`)} onClick={() => void act(i.id, "cancel")}>Cancel</Button> : null}
          {i.state === "failed" || i.state === "cancelled" ? <Button tone="ghost" size="sm" pending={busy(`retry-${i.id}`)} onClick={() => void act(i.id, "retry")}>Try again</Button> : null}
        </td>
      </tr>
    );
  };

  return (
    <main className="app">
      <StudioBar />
      <div className="page-head"><div><p className="kicker">Studio</p><h1>Queue</h1></div></div>
      <Notice tone="bad" onClose={() => setError("")}>{error}</Notice>
      {items === null ? <div className="surface panel skeleton" /> : !items.length ? <Empty title="Nothing in the queue"><p className="fine">Plans, renders, stills and exports show up here while they run.</p></Empty> : (
        <>
          <section className="surface panel">
            <h2>Working now</h2>
            {active.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Job</th><th>State</th><th>When</th><th /></tr></thead><tbody>{active.map(row)}</tbody></table></div> : <p className="fine">Nothing is running.</p>}
          </section>
          <section className="surface panel">
            <h2>Recent</h2>
            <div className="table-wrap"><table className="table"><thead><tr><th>Job</th><th>State</th><th>When</th><th /></tr></thead><tbody>{done.map(row)}</tbody></table></div>
          </section>
        </>
      )}
    </main>
  );
}
