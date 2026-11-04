"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Brand } from "../brand";
import { films, type Film } from "./films";

const modes = [
  { title: "Explainer", copy: "A topic becomes scenes, a narrator and captions on the words.", state: "In the studio", src: "/films/moon.mp4", poster: "/films/moon.jpg" },
  { title: "Code Lab", copy: "Your Python runs in your browser. The trace decides what the film shows.", state: "In the studio", src: "/films/code-lab.mp4", poster: "/films/code-lab.jpg" },
  { title: "Story", copy: "A cast performs the beats. The head, mouth and body move with the voice.", state: "In the studio", src: "/films/story-new.mp4", poster: "/films/story-new.jpg" },
  { title: "Cartoon", copy: "The same stage, brighter, with a recurring cast you pick.", state: "In the studio", src: "/films/cartoon-new.mp4", poster: "/films/cartoon-new.jpg" },
  { title: "Audio", copy: "Your script, read aloud, one word at a time on the measured voice.", state: "In the studio", src: "/films/method.mp4", poster: "/films/method.jpg" },
  { title: "Lyrics", copy: "Your song, with each line on screen when it is sung.", state: "In the studio", src: "/films/lyrics.mp4", poster: "/films/lyrics.jpg" },
  { title: "Montage", copy: "Your clips, cut on the beats of your music.", state: "In the studio", src: "/films/guests.mp4", poster: "/films/guests.jpg" },
  { title: "Series", copy: "Episodes that keep their cast, places and rules.", state: "In the studio", src: "/films/wedding.mp4", poster: "/films/wedding.jpg" },
];

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

export function HomePage() {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState(films[0].id);
  const [sound, setSound] = useState(false);
  const stageRef = useRef<HTMLVideoElement>(null);
  const heroRef = useRef<HTMLVideoElement>(null);
  const active = films.find((film) => film.id === activeId) ?? films[0];

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const hero = heroRef.current;
    if (!hero || reduced) return;
    hero.muted = true;
    void hero.play().catch(() => undefined);
  }, []);

  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    node.muted = !(sound && active.audio);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      node.pause();
      return;
    }
    void node.play().catch(() => undefined);
  }, [active, sound]);

  function choose(film: Film) {
    setActiveId(film.id);
    if (!film.audio) setSound(false);
  }

  function toggleSound() {
    const node = stageRef.current;
    if (!active.audio || !node) return;
    const next = !sound;
    setSound(next);
    node.muted = !next;
    void node.play().catch(() => undefined);
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
          <p className="fine">Made in this studio. It starts muted; open it below for sound.</p>
        </div>
        <figure className="hero-phone">
          <div className="phone">
            <video
              ref={heroRef}
              src="/films/moon.mp4"
              poster="/films/moon.jpg"
              muted
              loop
              playsInline
              preload="metadata"
            />
          </div>
          <figcaption>
            <strong>Why it stays up</strong>
            <span>Explainer · the picture moves with the voice</span>
          </figcaption>
        </figure>
      </section>

      <section id="films" className="block">
        <div className="sprockets" aria-hidden="true" />
        <div className="block-head">
          <p className="kicker">Rendered here</p>
          <h2>Films this studio has already made.</h2>
          <p>Five films. Each one states a problem, then the way through it. The voice says the words on the screen.</p>
        </div>
        <div className="stage">
          <div className="phone phone-lg">
            <video
              key={active.id}
              ref={stageRef}
              src={active.src}
              poster={active.poster}
              loop
              playsInline
              controls
              preload="metadata"
            />
          </div>
          <div className="stage-copy">
            <p className="kicker">{active.kind} · {active.length}{active.audio ? " · with voice" : " · silent"}</p>
            <h3>{active.title}</h3>
            <p>{active.detail}</p>
            <button className="btn ghost" type="button" onClick={toggleSound} disabled={!active.audio}>
              {active.audio ? (sound ? "Mute" : "Play with sound") : "No voice in this file"}
            </button>
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
          <p>Each tile plays a different film. Story and Cartoon perform on a 3D stage. Lyrics sit on the sung line.</p>
        </div>
        <div className="bento">
          {modes.map((mode) => (
            <article key={mode.title} className="tile">
              <video src={mode.src} poster={mode.poster} muted loop playsInline preload="metadata" autoPlay />
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
        <p className="fine">SceneSpindle. Built on what Leela and Reel Studio taught us.</p>
        <div className="marks">
          <a className="mark" href="https://aryanjaiswal.in" aria-label="Aryan Jaiswal, portfolio">
            <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" strokeWidth="1.6"/><path fill="currentColor" d="M16 7.5 22.2 24h-2.5l-1.4-4h-4.6l-1.4 4H9.8L16 7.5zm0 6.2-1.5 4.2h3L16 13.7z"/></svg>
          </a>
          <a className="mark" href="https://github.com/Aryanjstar" aria-label="GitHub">
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
