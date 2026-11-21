export function listPersonaRooms(project) {
  return [{ id: 'room-1', name: project.roomName.trim() || 'Room' }];
}
