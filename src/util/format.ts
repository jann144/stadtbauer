const numberFormat = new Intl.NumberFormat('de-DE');

const MONTHS = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];

/** Ganze Zahl mit Tausenderpunkten, etwa „12.340“. */
export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

/** Geldbetrag, abgerundet auf ganze Euro: „12.340 €“. So zeigt die Anzeige nie mehr, als ausgegeben werden kann. */
export function formatMoney(amount: number): string {
  return `${numberFormat.format(Math.floor(amount))} €`;
}

/** Geldbetrag mit Vorzeichen, kaufmännisch gerundet: „+651 €“ oder „−113 €“. */
export function formatSigned(amount: number): string {
  const rounded = Math.round(amount);
  return `${rounded < 0 ? '−' : '+'}${numberFormat.format(Math.abs(rounded))} €`;
}

/** Name des Monats mit der Nummer 1 bis 12. */
export function monthName(month: number): string {
  return MONTHS[month - 1];
}
