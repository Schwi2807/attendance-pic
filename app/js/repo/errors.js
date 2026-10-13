// Errors shared by every repository implementation.

export class SeatTakenError extends Error {
  constructor(seatId, participantId) {
    super('That seat is already taken.');
    this.name = 'SeatTakenError';
    this.seatId = seatId;
    this.participantId = participantId;
  }
}

export const BACKUP_FORMAT = 'attendance-pic/backup';
