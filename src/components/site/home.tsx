"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Brand } from "../brand";
import { films, type Film } from "./films";

const modes = films.map((film) => ({
  title: film.kind,
  copy: film.detail,
  state: "In the studio",
  film,
}));

const steps = [
  ["01", "Idea", "A topic, who it is for, and what must be in the film."],
  ["02", "Plan", "The model picks named scenes from a catalog. It never writes the HTML."],
  ["03", "Voice", "Speech is recorded and measured. Captions sit on the words."],
  ["04", "Render", "HyperFrames draws the frames. FFmpeg mixes to -14 LUFS. Checks run before it is yours."],
];

const stack = [
  ["Studio", "Next.js, React, TypeScript"],
  ["Records", "MongoDB. Your projects stay on your account."],
  ["Picture", "HyperFrames and GSAP. FFmpeg writes the MP4."],
  ["Plan", "Gemini, behind an adapter. The plan is data."],
  ["Voice", "ElevenLabs or Sarvam, behind an adapter with a monthly allowance. A voice never swaps in silence."],
  ["Trace", "Code Lab reads an execution trace. The model does not invent the steps."],
];

/**
 * Every film on the page plays only when clicked, with sound, once to the end. Starting one film
 * pauses whichever was playing. Nothing downloads until a film is clicked (the poster shows first),
 * so the page stays light on a slow connection.
 */
function Reel({ film, className = "", autoStart = false }: { film: Film; className?: string; autoStart?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"idle" | "loading" | "playing" | "paused" | "ended">("idle");

  const start = () => {
    const node = ref.current;
    if (!node) return;
    if (node.ended) node.currentTime = 0;
    node.muted = false;
    setState("loading");
    void node.play().catch(() => setState("paused"));
  };

  useEffect(() => {
    if (autoStart) start();
    // Starts once when a film is chosen from the strip (a click), never on page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const started = state !== "idle";
  return (
    <div className={`reel ${className}`} data-state={state}>
      <video
        ref={ref}
        src={film.src}
        poster={film.poster}
        playsInline
        preload="none"
        controls={started && state !== "ended"}
        onPlaying={() => setState("playing")}
        onWaiting={() => setState("loading")}
        onPause={(e) => { if (!e.currentTarget.ended) setState("paused"); }}
        onEnded={() => setState("ended")}
        aria-label={`${film.title}, ${film.kind}`}
      />
      {state === "idle" || state === "ended" ? (
        <button type="button" className="reel-play" onClick={start} aria-label={`${state === "ended" ? "Play again" : "Play"}: ${film.title}`}>
          <span className="reel-icon" aria-hidden="true">{state === "ended" ? "↻" : "▶"}</span>
          <span className="reel-label">{state === "ended" ? "Play again" : `Play · ${film.length}`}</span>
        </button>
      ) : null}
      {state === "loading" ? <span className="reel-spin" aria-hidden="true" /> : null}
    </div>
  );
}

export function HomePage() {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState(films[1].id);
  const [picked, setPicked] = useState(false);
  const hero = films[0];
  const active = films.find((film) => film.id === activeId) ?? hero;

  // One film at a time: any film that starts pauses every other film on the page.
  useEffect(() => {
    const onPlay = (event: Event) => {
      document.querySelectorAll("video").forEach((video) => { if (video !== event.target && !video.paused) video.pause(); });
    };
    document.addEventListener("play", onPlay, true);
    return () => document.removeEventListener("play", onPlay, true);
  }, []);

  function choose(film: Film) {
    setActiveId(film.id);
    setPicked(true);
  }

  return (
    <div className="site">
      <header className={open ? "site-bar is-open" : "site-bar"}>
        <Brand />
        <nav className="site-nav" aria-label="Page">
          <a href="#films" onClick={() => setOpen(false)}>Films</a>
          <a href="#modes" onClick={() => setOpen(false)}>Modes</a>
          <a href="#method" onClick={() => setOpen(false)}>Method</a>
          <a href="#stack" onClick={() => setOpen(false)}>Stack</a>
        </nav>
        <div className="site-bar-end">
          <Link className="btn sm" href="/sign-in">Sign in</Link>
          <button className="menu" type="button" aria-expanded={open} aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen((value) => !value)}>
            <span />
            <span />
          </button>
        </div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="hindi" lang="hi">दृश्य, एक धागे में</p>
          <h1>Scenes, spun from <em>a single idea.</em></h1>
          <p className="lede">
            An invite-only studio for short films. Bring a topic, a script or a piece of code. SceneSpindle plans the scenes, a narrator reads them, and code draws every frame to the measured voice.
          </p>
          <div className="hero-actions">
            <Link className="btn accent lg" href="/sign-in">Open the studio</Link>
            <a className="btn ghost lg" href="#films">Watch the films</a>
          </div>
          <p className="fine">Made in this studio. Tap a film to play it with sound.</p>
        </div>
        <figure className="hero-phone">
          <div className="phone">
            <Reel film={hero} />
          </div>
          <figcaption>
            <strong>{hero.title}</strong>
            <span>{hero.kind} · {hero.length}</span>
          </figcaption>
        </figure>
      </section>

      <section id="films" className="block">
        <div className="sprockets" aria-hidden="true" />
        <div className="block-head">
          <p className="kicker">Rendered here</p>
          <h2>Eight new films, one for every mode.</h2>
          <p>Each one was rendered by this studio. The old showreel is not on this page. Pick one to play it.</p>
        </div>
        <div className="stage">
          <div className="phone phone-lg">
            <Reel key={active.id} film={active} autoStart={picked} />
          </div>
          <div className="stage-copy">
            <p className="kicker">{active.kind} · {active.length}{active.audio ? " · with voice" : " · silent"}</p>
            <h3>{active.title}</h3>
            <p>{active.detail}</p>
          </div>
        </div>
        <div className="strip">
          {films.map((film) => (
            <button
              key={film.id}
              type="button"
              className={film.id === active.id ? "thumb is-on" : "thumb"}
              aria-pressed={film.id === active.id}
              aria-label={`${film.title}, ${film.audio ? "with voice" : "silent"}`}
              onClick={() => choose(film)}
            >
              <img src={film.poster} alt="" />
              <span>{film.title}</span>
              <small>{film.audio ? "Voice" : "Silent"} · {film.length}</small>
            </button>
          ))}
        </div>
      </section>

      <section id="modes" className="block">
        <div className="block-head">
          <p className="kicker">What it makes</p>
          <h2>One pipeline. Every mode you can open in the studio.</h2>
          <p>Tap any tile to play its film. Story and Cartoon perform on a 3D stage. Lyrics sit on the sung line.</p>
        </div>
        <div className="bento">
          {modes.map((mode) => (
            <article key={mode.title} className="tile">
              <Reel film={mode.film} />
              <h3>{mode.title}</h3>
              <p>{mode.copy}</p>
              <span className="badge" data-tone="ready">{mode.state}</span>
            </article>
          ))}
        </div>
      </section>

      <section id="method" className="block">
        <div className="block-head">
          <p className="kicker">Method</p>
          <h2>The model writes the plan. Code writes the film.</h2>
        </div>
        <ol className="steps">
          {steps.map(([n, title, copy]) => (
            <li key={n}>
              <span>{n}</span>
              <h3>{title}</h3>
              <p>{copy}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="stack" className="block">
        <div className="block-head">
          <p className="kicker">Stack</p>
          <h2>What actually runs.</h2>
        </div>
        <dl className="stack">
          {stack.map(([name, copy]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>{copy}</dd>
            </div>
          ))}
        </dl>
      </section>

      <footer className="site-foot">
        <Brand />
        <p className="fine">SceneSpindle. An idea, a script, or a song becomes a film.</p>
        <div className="marks">
          <a className="mark" href="https://aryanjaiswal.in" aria-label="Aryan Jaiswal, portfolio">
            <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" strokeWidth="1.6"/><path fill="currentColor" d="M16 7.5 22.2 24h-2.5l-1.4-4h-4.6l-1.4 4H9.8L16 7.5zm0 6.2-1.5 4.2h3L16 13.7z"/></svg>
          </a>
          <a className="mark" href="https://github.com/Aryanjstar/scenespindle" aria-label="GitHub">
            <svg viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="M16 4a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.1c-3.3.7-4-1.6-4-1.6-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 .1.8 1.8 2.6 1.3.1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6a4.7 4.7 0 0 1 1.2-3.2 4.3 4.3 0 0 1 .1-3.2s1-.3 3.3 1.2a11.3 11.3 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2a4.3 4.3 0 0 1 .1 3.2 4.7 4.7 0 0 1 1.2 3.2c0 4.7-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 16 4z"/></svg>
          </a>
          <a className="mark" href="https://nextjs.org" aria-label="Next.js">
            <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" strokeWidth="1.6"/><path d="M12 22 V10 l10 12" fill="none" stroke="currentColor" strokeWidth="1.6"/></svg>
          </a>
          <a className="mark" href="https://www.mongodb.com" aria-label="MongoDB">
            <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 4c2 5 4 8 4 13a4 4 0 0 1-8 0c0-5 2-8 4-13z" fill="currentColor"/><path d="M16 26 v3" stroke="currentColor" strokeWidth="1.6"/></svg>
          </a>
        </div>
      </footer>
    </div>
  );
}
