export const designerPageSize = 100;

export async function readDesignerPages<Row>(load: (after?: Row) => Promise<readonly Row[]>) {
  const rows: Row[] = [];
  let after: Row | undefined;
  for (;;) {
    const page = await load(after);
    rows.push(...page);
    if (page.length < designerPageSize) return rows;
    after = page[page.length - 1];
  }
}

export function designerSearchText(value: unknown) {
  return typeof value === "string" ? value.normalize("NFKD").replace(/\p{M}/gu, "")
    .toLowerCase().replace(/ı/g, "i").trim().replace(/\s+/g, " ") : "";
}
