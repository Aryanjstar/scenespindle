export type Film = {
  id: string;
  title: string;
  kind: string;
  length: string;
  audio: boolean;
  src: string;
  poster: string;
  detail: string;
};

/** Films rendered by the current studio. Older showreel files are not listed. */
export const films: Film[] = [
  {
    id: "story",
    title: "Paper boat",
    kind: "Story",
    length: "8s",
    audio: true,
    src: "/films/show-story.mp4",
    poster: "/films/show-story.jpg",
    detail: "Meera walks, waves and holds the boat. Her head, mouth and feet stay inside the frame, and the words sit below her.",
  },
  {
    id: "cartoon",
    title: "Tikku",
    kind: "Cartoon",
    length: "8s",
    audio: true,
    src: "/films/show-cartoon.mp4",
    poster: "/films/show-cartoon.jpg",
    detail: "The same stage in cartoon colour. Tikku crosses the lane, waves, and turns, with the caption under his feet.",
  },
  {
    id: "series",
    title: "Meera and Tikku",
    kind: "Series",
    length: "8s",
    audio: true,
    src: "/films/show-series.mp4",
    poster: "/films/show-series.jpg",
    detail: "Two performers share one stage. Both stay fully in frame while one walks and the other answers.",
  },
  {
    id: "explainer",
    title: "Why ice floats",
    kind: "Explainer",
    length: "31s",
    audio: true,
    src: "/films/show-explainer.mp4",
    poster: "/films/show-explainer.jpg",
    detail: "A topic, a title and a caption. The words stay in the frame and follow the voice.",
  },
  {
    id: "code",
    title: "Find 33",
    kind: "Code Lab",
    length: "25s",
    audio: true,
    src: "/films/show-code.mp4",
    poster: "/films/show-code.jpg",
    detail: "The array, the markers and the answer come from a real run. The row fits the width of the frame.",
  },
  {
    id: "audio",
    title: "Leaves",
    kind: "Audio",
    length: "11s",
    audio: true,
    src: "/films/show-audio.mp4",
    poster: "/films/show-audio.jpg",
    detail: "One word at a time, in the middle of the frame, with the voice underneath.",
  },
  {
    id: "lyrics",
    title: "Spin the spindle",
    kind: "Lyrics",
    length: "20s",
    audio: true,
    src: "/films/show-lyrics.mp4",
    poster: "/films/show-lyrics.jpg",
    detail: "The sung line sits in the middle. The word you hear is the word that lights up.",
  },
  {
    id: "montage",
    title: "On the beat",
    kind: "Montage",
    length: "12s",
    audio: true,
    src: "/films/show-montage.mp4",
    poster: "/films/show-montage.jpg",
    detail: "The new films, cut on a 120 beat. Each cut keeps the whole frame.",
  },
];
