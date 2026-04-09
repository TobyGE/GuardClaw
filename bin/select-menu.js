export function getMenuPageSize(totalOptions, terminalRows = 24, titleLines = 0) {
  if (totalOptions <= 0) return 0;

  const rows = Number.isFinite(terminalRows) && terminalRows > 0 ? terminalRows : 24;
  const reservedRows = Math.max(4, titleLines + 4);
  return Math.max(1, Math.min(totalOptions, rows - reservedRows));
}

export function getMenuViewport(totalOptions, cursor, pageSize, offset = 0) {
  if (totalOptions <= 0) {
    return {
      offset: 0,
      start: 0,
      end: 0,
      pageSize: 0,
      hasOverflow: false,
      above: 0,
      below: 0,
    };
  }

  const safePageSize = Math.max(1, Math.min(pageSize, totalOptions));
  const maxOffset = Math.max(0, totalOptions - safePageSize);
  let nextOffset = Math.max(0, Math.min(offset, maxOffset));

  if (cursor < nextOffset) nextOffset = cursor;
  if (cursor >= nextOffset + safePageSize) nextOffset = cursor - safePageSize + 1;

  const start = nextOffset;
  const end = Math.min(totalOptions, start + safePageSize);

  return {
    offset: nextOffset,
    start,
    end,
    pageSize: safePageSize,
    hasOverflow: totalOptions > safePageSize,
    above: start,
    below: totalOptions - end,
  };
}
