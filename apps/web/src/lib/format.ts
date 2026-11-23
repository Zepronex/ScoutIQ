import { Pos } from './types';

export const formatPrice = (price: number): string => {
  return `${price < 0 ? '−' : ''}£${Math.abs(price).toFixed(1)}m`;
};

type FormationSlot = { pos: Pos };

export const isValidFormation = (startingXI: FormationSlot[]): boolean => {
  if (startingXI.length !== 11) return false;
  
  const positionCounts = startingXI.reduce((counts, slot) => {
    counts[slot.pos] = (counts[slot.pos] || 0) + 1;
    return counts;
  }, {} as Record<string, number>);
  
  // Must have exactly 1 goalkeeper
  if (positionCounts.GK !== 1) return false;
  
  // Must have 3-5 defenders, 2-5 midfielders, 1-3 forwards
  const defCount = positionCounts.DEF || 0;
  const midCount = positionCounts.MID || 0;
  const fwdCount = positionCounts.FWD || 0;
  
  return defCount >= 3 && defCount <= 5 &&
         midCount >= 2 && midCount <= 5 &&
         fwdCount >= 1 && fwdCount <= 3;
};

export const getFormationString = (startingXI: FormationSlot[]): string => {
  if (!isValidFormation(startingXI)) return 'Invalid';
  
  const positionCounts = startingXI.reduce((counts, slot) => {
    counts[slot.pos] = (counts[slot.pos] || 0) + 1;
    return counts;
  }, {} as Record<string, number>);
  
  const defCount = positionCounts.DEF || 0;
  const midCount = positionCounts.MID || 0;
  const fwdCount = positionCounts.FWD || 0;
  
  return `${defCount}-${midCount}-${fwdCount}`;
};


export const positionNames: Record<Pos, string> = {
  GK: 'Goalkeepers', DEF: 'Defenders', MID: 'Midfielders', FWD: 'Forwards'
};

export function normalizePlayerSearch(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

// The app is written in British English, so figures and dates follow en-GB
// whatever the browser locale. Times are still shown in the visitor's zone.
const pointsFormatter = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
const onePlace = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const wholeNumber = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const dateTime = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const shortDateTime = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const formatPoints = (points: number) => pointsFormatter.format(points);
/** A single player's projection. One decimal is as precise as the model warrants. */
export const formatXp = (points: number) => onePlace.format(points);
export const formatOnePlace = (value: number) => onePlace.format(value);
export const formatCount = (value: number) => wholeNumber.format(value);
export const formatSigned = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${pointsFormatter.format(Math.abs(value))}`;
export const formatDateTime = (value: string | Date) => dateTime.format(new Date(value));
export const formatShortDateTime = (value: string | Date) => shortDateTime.format(new Date(value));

/** "3 days 4 hrs", "5 hrs 12 min" or "12 min" until a deadline; null once it has passed. */
export function formatCountdown(deadline: string, now = Date.now()): string | null {
  const minutes = Math.floor((Date.parse(deadline) - now) / 60_000);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days} ${days === 1 ? 'day' : 'days'} ${hours} ${hours === 1 ? 'hr' : 'hrs'}`;
  if (hours > 0) return `${hours} ${hours === 1 ? 'hr' : 'hrs'} ${minutes % 60} min`;
  return `${minutes} min`;
}

export function predictionAvailability(player: { fixtureCount?: number; availability?: string }): string {
  if (player.fixtureCount === 0) return 'No fixture';
  if (player.availability === 'unavailable') return 'Unavailable';
  if (player.availability === 'doubtful') return 'Doubtful';
  if (player.fixtureCount && player.fixtureCount > 1) return `${player.fixtureCount} fixtures`;
  return player.availability === 'available' ? 'Available' : 'Availability unknown';
}
