export function listPersonaRooms(project) {
  const rooms = (project.importedHouse || project.house)?.rooms;
  if (rooms?.length) {
    return rooms.map(({ id, name }, index) => ({
      id,
      name: String(name ?? '').trim().slice(0, 80) || `Room ${index + 1}`,
    }));
  }
  return [{ id: 'room-1', name: project.roomName.trim() || 'Room' }];
}
