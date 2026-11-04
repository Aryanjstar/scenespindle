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
    length: "16s",
    audio: true,
    src: "/films/show-story.mp4",
    poster: "/films/show-story.jpg",
    detail: "Meera folds a boat, walks to the river, sets it on the water, and brings it home.",
  },
  {
    id: "cartoon",
    title: "Tikku",
    kind: "Cartoon",
    length: "18s",
    audio: true,
    src: "/films/show-cartoon.mp4",
    poster: "/films/show-cartoon.jpg",
    detail: "Tikku waits, crosses the lane, lets the bus pass, and walks back home.",
  },
  {
    id: "series",
    title: "Meera and Tikku",
    kind: "Series",
    length: "17s",
    audio: true,
    src: "/films/show-series.mp4",
    poster: "/films/show-series.jpg",
    detail: "Meera and Tikku take the boat to the river and walk it back together.",
  },
  {
    id: "explainer",
    title: "Why ice floats",
    kind: "Explainer",
    length: "29s",
    audio: true,
    src: "/films/show-explainer.mp4",
    poster: "/films/show-explainer.jpg",
    detail: "Why ice floats: the molecules spread, the ice gets lighter, and it rises.",
  },
  {
    id: "code",
    title: "Find 33",
    kind: "Code Lab",
    length: "29s",
    audio: true,
    src: "/films/show-code.mp4",
    poster: "/films/show-code.jpg",
    detail: "Binary search walks a real sorted list until it returns the index of 33.",
  },
  {
    id: "audio",
    title: "Leaves",
    kind: "Audio",
    length: "25s",
    audio: true,
    src: "/films/show-audio.mp4",
    poster: "/films/show-audio.jpg",
    detail: "Why leaves change colour, one word at a time, on the measured voice.",
  },
  {
    id: "lyrics",
    title: "Spin the spindle",
    kind: "Lyrics",
    length: "20s",
    audio: true,
    src: "/films/show-lyrics.mp4",
    poster: "/films/show-lyrics.jpg",
    detail: "The whole song, with each line on screen as it is sung.",
  },
  {
    id: "montage",
    title: "On the beat",
    kind: "Montage",
    length: "12s",
    audio: true,
    src: "/films/show-montage.mp4",
    poster: "/films/show-montage.jpg",
    detail: "The new films, cut together on a 120 beat.",
  },
];
