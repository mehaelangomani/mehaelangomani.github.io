export interface StudyCard {
  id: string;
  videoUrl: string;
  left: string;
  right: string;
  tags: string[];
}

export const TAG_CHIPS: string[] = [
  'All',
  'Light',
  'Physics',
  'Fluids',
  'Grid',
  'Audio',
  'Volumes',
  'Particles',
  'Capture',
  'Render',
];

export const STUDY_CARDS: StudyCard[] = [
  {
    id: 'lattices',
    videoUrl: 'https://pub-86dc5b5484314368ac5436a674b0d919.r2.dev/aaaf/oraciteslArea.mp4',
    left: 'Lattices\nzone',
    right: 'Ambient light\nstudy',
    tags: ['Light', 'Grid', 'Volumes', 'Render'],
  },
  {
    id: 'prism',
    videoUrl: 'https://pub-86dc5b5484314368ac5436a674b0d919.r2.dev/aaaf/facet-glass-hero.mp4',
    left: 'Prism\nshell',
    right: 'Dispersion hero\nrender',
    tags: ['Light', 'Render', 'Particles', 'Audio'],
  },
  {
    id: 'nebular',
    videoUrl: 'https://pub-86dc5b5484314368ac5436a674b0d919.r2.dev/aaaf/stellarmind-hero.mp4',
    left: 'Nebular\nloop',
    right: 'Procedural hero\nsequence',
    tags: ['Fluids', 'Particles', 'Volumes', 'Capture'],
  },
  {
    id: 'fall',
    videoUrl: 'https://pub-86dc5b5484314368ac5436a674b0d919.r2.dev/aaaf/thedropthroughArea.mp4',
    left: 'Fall\nforward',
    right: 'Dolly track\nstudy',
    tags: ['Physics', 'Fluids', 'Capture', 'Grid'],
  },
];
