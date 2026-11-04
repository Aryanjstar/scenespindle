"use client";

import { useEffect, useState } from "react";

type Character = { id: string; name: string; style: string; description: string };

export function CastPanel({ projectId, selected, onChange }: { projectId: string; selected: string[]; onChange: (ids: string[]) => void }) {
  const [items, setItems] = useState<Character[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/characters").then(async (response) => {
      if (response.ok) setItems((await response.json()).items || []);
    });
  }, []);

  async function toggle(id: string) {
    const next = selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id].slice(0, 6);
    setError("");
    const response = await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ castIds: next }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body?.error?.message || "Could not save the cast.");
      return;
    }
    onChange(body.project.castIds || next);
  }

  return (
    <section className="surface panel" aria-label="Cast">
      <div>
        <p className="kicker">Cast</p>
        <h2>Who performs</h2>
        <p className="fine">One or two characters share the stage. They turn, walk and move their mouths with the narration. Add people in the library first.</p>
      </div>
      {items.length === 0 ? <p className="fine">No characters yet. The stage still performs with a single lead.</p> : (
        <div className="cast-pick">
          {items.map((item) => (
            <label key={item.id}>
              <input type="checkbox" checked={selected.includes(item.id)} onChange={() => void toggle(item.id)} aria-label={item.name} />
              <span className="ph" aria-hidden="true">{item.name.slice(0, 1)}</span>
              {item.name}
            </label>
          ))}
        </div>
      )}
      {error ? <p className="error" role="alert">{error}</p> : null}
    </section>
  );
}
