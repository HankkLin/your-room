export function listPersonaRooms(project) {
  if (project.importedHouse?.rooms?.length) {
    return project.importedHouse.rooms.map(({ id, name }, index) => ({
      id,
      name: String(name ?? '').trim().slice(0, 80) || `Room ${index + 1}`,
    }));
  }
  return [{ id: 'room-1', name: project.roomName.trim() || 'Room' }];
}
