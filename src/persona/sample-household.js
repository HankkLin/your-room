export function createSampleHousehold(rooms) {
  const [study, livingRoom = study] = rooms;
  if (!study) return [];

  return [
    {
      id: 'sample-alex',
      name: 'Alex',
      ageGroup: 'adult',
      preferences: ['Quiet workspace'],
      dislikes: ['TV noise during work'],
      needs: { privacy: 0.7, quiet: 0.9, accessibility: 0.2, daylight: 0.7, social: 0.4 },
      schedule: [
        { activity: 'work', roomId: study.id, startMinute: 540, endMinute: 1020 },
      ],
    },
    {
      id: 'sample-sam',
      name: 'Sam',
      ageGroup: 'adult',
      preferences: ['Watching TV after studying'],
      dislikes: [],
      needs: { privacy: 0.4, quiet: 0.5, accessibility: 0.2, daylight: 0.5, social: 0.7 },
      schedule: [
        { activity: 'study', roomId: study.id, startMinute: 900, endMinute: 960 },
        { activity: 'watchTv', roomId: livingRoom.id, startMinute: 960, endMinute: 1020 },
      ],
    },
  ];
}
