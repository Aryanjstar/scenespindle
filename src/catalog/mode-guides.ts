/** What each studio mode is, in plain language, shown when that mode is chosen. */

export type ModeGuide = {
  what: string;
  need: string;
  steps: string[];
};

export const MODE_GUIDES: Record<string, ModeGuide> = {
  explainer: {
    what: "A short narrated film that explains one idea with words on screen.",
    need: "One sentence about the idea. We fill in the audience, the length, and the lines.",
    steps: ["Write the idea", "We draft the lines and show them", "The film is made", "Open Customize if you want to edit every scene first"],
  },
  code_lab: {
    what: "A film of a real program run. The numbers on screen come from the code, not from the model.",
    need: "A short Python or JavaScript program, and one line about what it should teach.",
    steps: ["Paste the code and run the trace", "We describe only the steps that are on screen", "The film is made", "Open Customize to change a line before it renders"],
  },
  story: {
    what: "A short story performed by a small 3D cast. They walk, wave, and talk on a simple stage.",
    need: "One or two sentences of the story. We choose the cast and the scenes.",
    steps: ["Write the story", "We draft who does what", "The film is made", "Open Customize to pick the cast and edit each scene"],
  },
  cartoon: {
    what: "The same stage as a story, drawn brighter, for a recurring character.",
    need: "One or two sentences about the character and what happens.",
    steps: ["Write what happens", "We draft the scenes", "The film is made", "Open Customize to change the look of each character"],
  },
  audio: {
    what: "Your words, read aloud, with each word appearing as it is spoken.",
    need: "The line you want said, or a few sentences.",
    steps: ["Write what should be said", "We turn it into timed lines", "The film is made", "Open Customize to paste an exact script"],
  },
  lyrics: {
    what: "Your song, with each line on screen while it is sung.",
    need: "The audio file and the lyric times (an LRC file, or lines we can space evenly).",
    steps: ["Add the song and the lyrics", "Check the lines", "Make the lyric video", "Open Customize for the caption style"],
  },
  montage: {
    what: "Your photos and clips, cut on the beat of a piece of music.",
    need: "At least one clip, and music if you want the cuts to follow a beat.",
    steps: ["Choose the clips and the music", "Pick a style", "Render the montage", "Open Customize for chapter titles and pacing"],
  },
  reel: {
    what: "Captions on a reel you already made. The words land on the speech.",
    need: "An MP4 of the reel, and either the words or a recording we can hear.",
    steps: ["Upload the reel", "Paste the words or let the studio listen", "Choose where the captions sit", "Caption the reel"],
  },
};
