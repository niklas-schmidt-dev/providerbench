const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const SHORT_DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

export function formatMeasurementDate(value: string | number | Date): string {
  return `${DATE_FORMAT.format(new Date(value))} UTC`;
}

export function formatMeasurementDateTime(
  value: string | number | Date,
): string {
  return `${DATE_TIME_FORMAT.format(new Date(value))} UTC`;
}

export function formatMeasurementWindow(start: string, end: string): string {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (
    startDate.getUTCFullYear() === endDate.getUTCFullYear() &&
    startDate.getUTCMonth() === endDate.getUTCMonth() &&
    startDate.getUTCDate() === endDate.getUTCDate()
  ) {
    return formatMeasurementDate(endDate);
  }
  return `${SHORT_DATE_FORMAT.format(startDate)}–${DATE_FORMAT.format(endDate)} UTC`;
}

export function formatChartDate(value: string | number | Date): string {
  return SHORT_DATE_FORMAT.format(new Date(value));
}
