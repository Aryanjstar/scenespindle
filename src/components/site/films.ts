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
    length: "31s",
    audio: true,
    src: "/films/story-v4.mp4",
    poster: "/films/story-v4.jpg",
    detail: "A rainy day indoors. Dadi folds Meera a paper boat, they run to the river, and it sails.",
  },
  {
    id: "cartoon",
    title: "Tikku",
    kind: "Cartoon",
    length: "28s",
    audio: true,
    src: "/films/cartoon-v4.mp4",
    poster: "/films/cartoon-v4.jpg",
    detail: "Tikku wants a mango. He stops, looks both ways, lets the bus pass, then crosses.",
  },
  {
    id: "series",
    title: "Meera and Tikku",
    kind: "Series",
    length: "16s",
    audio: true,
    src: "/films/series-v4.mp4",
    poster: "/films/series-v4.jpg",
    detail: "Meera and Tikku walk to the river. She sets the boat on the water, and he waves.",
  },
  {
    id: "explainer",
    title: "Why ice floats",
    kind: "Explainer",
    length: "36s",
    audio: true,
    src: "/films/explainer-v4.mp4",
    poster: "/films/explainer-v4.jpg",
    detail: "Why ice floats: the molecules spread, the ice gets lighter, and it rises.",
  },
  {
    id: "code",
    title: "Find 33",
    kind: "Code Lab",
    length: "35s",
    audio: true,
    src: "/films/code-v4.mp4",
    poster: "/films/code-v4.jpg",
    detail: "Binary search walks a real sorted list until it returns the index of 33.",
  },
  {
    id: "audio",
    title: "Leaves",
    kind: "Audio",
    length: "25s",
    audio: true,
    src: "/films/audio-v4.mp4",
    poster: "/films/audio-v4.jpg",
    detail: "Why leaves change colour, one word at a time, on the measured voice.",
  },
  {
    id: "lyrics",
    title: "Spin the spindle",
    kind: "Lyrics",
    length: "20s",
    audio: true,
    src: "/films/lyrics-v4.mp4",
    poster: "/films/lyrics-v4.jpg",
    detail: "The whole song, with each line on screen as it is sung.",
  },
  {
    id: "montage",
    title: "On the beat",
    kind: "Montage",
    length: "12s",
    audio: true,
    src: "/films/montage-v4.mp4",
    poster: "/films/montage-v4.jpg",
    detail: "The new films, cut together on a 120 beat.",
  },
];
