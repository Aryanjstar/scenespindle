"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Brand } from "../../../components/brand";

type Payload = { title: string; durationMs: number; videoUrl: string; posterUrl: string; captionsUrl?: string; allowDownload: boolean; downloadUrl?: string };

export default function SharePage() {
  const params = useParams<{ token: string }>();
  const [film, setFilm] = useState<Payload | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    fetch(`/api/public/share/${params.token}`).then(async (response) => {
      if (!response.ok) {
        setMissing(true);
        return;
      }
      setFilm(await response.json());
    }).catch(() => setMissing(true));
  }, [params.token]);

  return (
    <main className="auth">
      <section style={{ display: "grid", gap: 16, justifyItems: "center", width: "min(380px, calc(100% - 32px))" }}>
        {missing ? (
          <div className="surface auth-card">
            <h1>That film is not available</h1>
            <p className="muted" style={{ margin: 0 }}>The link may have been revoked, or the film was removed.</p>
          </div>
        ) : film ? (
          <>
            <h1 className="display" style={{ fontSize: 30, textAlign: "center" }}>{film.title}</h1>
            <video className="player" style={{ width: "100%" }} controls playsInline preload="metadata" poster={film.posterUrl} aria-label={film.title}>
              <source src={film.videoUrl} type="video/mp4" />
              {film.captionsUrl ? <track kind="captions" src={film.captionsUrl} srcLang="en" label="Captions" /> : null}
            </video>
            <div className="row-actions" style={{ justifyContent: "center" }}>
              <span className="fine mono">{(film.durationMs / 1000).toFixed(0)} s</span>
              {film.allowDownload && film.downloadUrl ? <a className="btn ghost sm" href={film.downloadUrl}>Download</a> : null}
            </div>
          </>
        ) : (
          <p className="fine">Loading</p>
        )}
        <Brand />
      </section>
    </main>
  );
}
