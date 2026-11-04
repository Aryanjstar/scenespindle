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

export const films: Film[] = [
  {
    id: "meera",
    title: "Meera and the paper boat",
    kind: "Story",
    length: "54s",
    audio: true,
    src: "/films/story-new.mp4",
    poster: "/films/story-new.jpg",
    detail: "Made in the studio from one reference drawing: Meera stays the same girl in every scene, the stills are drawn to the beats, and the narrator reads them.",
  },
  {
    id: "tikku",
    title: "Tikku crosses the road",
    kind: "Cartoon, Hinglish",
    length: "42s",
    audio: true,
    src: "/films/cartoon-new.mp4",
    poster: "/films/cartoon-new.jpg",
    detail: "An original tiffin-box robot, described in one sentence, drawn consistently across a Mumbai street and narrated in Hinglish.",
  },
  {
    id: "find",
    title: "Find 21",
    kind: "Code Lab",
    length: "22s",
    audio: true,
    src: "/films/code-lab.mp4",
    poster: "/films/find-poster.jpg",
    detail: "The problem is a sorted list. The goal is to find 21 without reading every box. The middle is too low, then too high, then 21.",
  },
  {
    id: "top",
    title: "Why it stays up",
    kind: "Explainer",
    length: "16s",
    audio: true,
    src: "/films/moon.mp4",
    poster: "/films/top-poster.jpg",
    detail: "A top should fall. A spin pulls it upright. Stop the spin, and it falls. That is the whole idea.",
  },
  {
    id: "story",
    title: "Ek lattu",
    kind: "Story",
    length: "11s",
    audio: true,
    src: "/films/story.mp4",
    poster: "/films/story-poster.jpg",
    detail: "It should fall. A string and a spin, and it walks. The moon does the same trick, and it never lands.",
  },
  {
    id: "launch",
    title: "Any idea",
    kind: "Launch",
    length: "17s",
    audio: true,
    src: "/films/launch.mp4",
    poster: "/films/launch-poster.jpg",
    detail: "An idea is stuck. Three ways out: explainer, code lab, story. The model plans. You approve. Code renders.",
  },
  {
    id: "house",
    title: "One house",
    kind: "Product film",
    length: "16s",
    audio: true,
    src: "/films/wedding.mp4",
    poster: "/films/house-poster.jpg",
    detail: "The wedding is in ten chats. Mehendi, baraat, and the wedding day go on one board. A guest opens one link.",
  },
];
