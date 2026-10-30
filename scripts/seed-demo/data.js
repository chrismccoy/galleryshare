
export const DEMO_DOMAIN = 'demo.galleryshare.test';

export const DEMO_PASSWORD = 'demo-password-2026';

export const DEMO_USERS = Object.freeze([
  {
    first: 'maya',
    name: 'Maya Okafor',
    joinedDaysAgo: 40,
    galleries: [
      {
        title: 'Lisbon in October',
        description: 'Four days of hills, trams and long evenings by the river.',
        images: 24,
        prefix: 'IMG_',
        allowZip: true,
        shared: { views: 37 },
        createdDaysAgo: 21,
        texts: [
          ['Alfama at eight', 'Day 1'],
          ['Tram 28', null],
          ['Miradouro da Graça', 'The best view, the worst stairs.'],
          ['Belém', 'Day 2'],
          ['Cais do Sodré', null],
          ['LX Factory', 'Day 3'],
        ],
      },
      {
        title: 'Garden in June',
        description: null,
        images: 6,
        prefix: 'garden-',
        createdDaysAgo: 9,
        texts: [['Peonies', 'First bloom of the year.']],
      },
    ],
  },
  {
    first: 'jonas',
    name: 'Jonas Berg',
    joinedDaysAgo: 30,
    galleries: [
      {
        title: 'Ridge walk',
        description: 'From the hut to the summit and back before the rain.',
        images: 12,
        prefix: 'DSC',
        gridText: 'hide',
        createdDaysAgo: 14,
        texts: [
          ['The hut', null],
          ['Above the clouds', 'About 2,100 m.'],
        ],
      },
      { title: null, description: null, images: 1, prefix: 'scan-', createdDaysAgo: 3, texts: [] },
    ],
  },
  {
    first: 'priya',
    name: 'Priya Raman',
    joinedDaysAgo: 18,
    galleries: [
      {
        title: 'Coastline drafts',
        description: 'Old versions, kept for a while.',
        images: 9,
        prefix: 'coast-',
        trashed: true,
        createdDaysAgo: 12,
        texts: [],
      },
      {
        title: 'Family dinner',
        description: 'Sunday at grandma’s.',
        images: 3,
        prefix: 'PXL_',
        createdDaysAgo: 2,
        texts: [['Table set', null]],
      },
    ],
  },
]);

export const DEMO_INVITE_LABEL = 'For Sam (photo club)';
