// Lazy maintained XLSX implementation. No legacy SheetJS parser is bundled.
type Book = { SheetNames: string[]; Sheets: Record<string, any[]> };
export const utils = {
  book_new: (): Book => ({ SheetNames: [], Sheets: {} }),
  json_to_sheet: (rows: any[]) => rows,
  book_append_sheet: (book: Book, rows: any[], name: string) => {
    book.SheetNames.push(name);
    book.Sheets[name] = rows;
  },
  sheet_to_json: <T = any>(rows: any[]): T[] => rows,
};
export async function read(data: ArrayBuffer, _options?: any): Promise<Book> {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data);
  const result = utils.book_new();
  workbook.worksheets.forEach((sheet) => {
    const headers: string[] = [];
    sheet.getRow(1).eachCell((cell, column) => {
      headers[column] = String(cell.text);
    });
    const rows: any[] = [];
    sheet.eachRow((row, index) => {
      if (index === 1) return;
      const out: any = {};
      row.eachCell((cell, column) => {
        if (headers[column]) out[headers[column]] = cell.text;
      });
      rows.push(out);
    });
    utils.book_append_sheet(result, rows, sheet.name);
  });
  return result;
}
export async function writeFile(book: Book, name: string) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  for (const sheetName of book.SheetNames) {
    const sheet = workbook.addWorksheet(sheetName);
    const rows = book.Sheets[sheetName];
    const headers = [...new Set(rows.flatMap(Object.keys))];
    sheet.columns = headers.map((key) => ({ header: key, key, width: 24 }));
    rows.forEach((row) => sheet.addRow(row));
    sheet.getRow(1).font = { bold: true };
  }
  const bytes = await workbook.xlsx.writeBuffer();
  const objectUrl = URL.createObjectURL(
    new Blob([bytes as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
